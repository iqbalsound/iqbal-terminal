'use strict';
// Loads private keys in PEM / OpenSSH / PPK (v2 and v3) format and returns
// something ssh2 can consume. PPK files are converted in memory to PEM; nothing is written to disk.
const crypto = require('crypto');
const fs = require('fs');
const { utils } = require('ssh2');

class KeyError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// ---- small helpers for SSH wire-format blobs -------------------------------
function reader(buf) {
  let off = 0;
  return {
    string() {
      if (off + 4 > buf.length) throw new KeyError('Malformed PPK key blob', 'MALFORMED');
      const len = buf.readUInt32BE(off); off += 4;
      if (off + len > buf.length) throw new KeyError('Malformed PPK key blob', 'MALFORMED');
      const out = buf.subarray(off, off + len); off += len; return out;
    }
  };
}
const sshString = (b) => { const h = Buffer.alloc(4); h.writeUInt32BE(b.length); return Buffer.concat([h, b]); };
const stripZeros = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; return b.subarray(i); };
const toBig = (b) => (b.length ? BigInt('0x' + b.toString('hex')) : 0n);
const bigToBuf = (x) => { let h = x.toString(16); if (h.length % 2) h = '0' + h; return Buffer.from(h, 'hex'); };
const b64u = (b) => Buffer.from(b).toString('base64url');
const hmac = (algo, key, data) => crypto.createHmac(algo, key).update(data).digest();

function isPpk(text) { return /^\s*PuTTY-User-Key-File-[23]:/.test(text); }

async function argon2Derive(type, memory, passes, parallelism, salt, passphrase) {
  const { argon2d, argon2i, argon2id } = await import('hash-wasm');
  const fn = { Argon2d: argon2d, Argon2i: argon2i, Argon2id: argon2id }[type];
  if (!fn) throw new KeyError('Unsupported PPK key derivation: ' + type, 'UNSUPPORTED');
  return Buffer.from(await fn({
    password: passphrase, salt, parallelism, iterations: passes, memorySize: memory,
    hashLength: 80, outputType: 'binary'
  }));
}

// ssh2 does not read PKCS#8 ed25519, so build an unencrypted OpenSSH-format key instead.
function ed25519OpenSsh(seed, pub, comment) {
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const pubBlob = Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(pub)]);
  const check = crypto.randomBytes(4);
  let priv = Buffer.concat([check, check, sshString(Buffer.from('ssh-ed25519')), sshString(pub),
    sshString(Buffer.concat([seed, pub])), sshString(Buffer.from(comment || ''))]);
  const pad = (8 - (priv.length % 8)) % 8;
  priv = Buffer.concat([priv, Buffer.from(Array.from({ length: pad }, (_, i) => i + 1))]);
  const body = Buffer.concat([Buffer.from('openssh-key-v1\0'), sshString(Buffer.from('none')), sshString(Buffer.from('none')),
    sshString(Buffer.alloc(0)), u32(1), sshString(pubBlob), sshString(priv)]);
  const b64 = body.toString('base64').match(/.{1,70}/g).join('\n');
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

async function ppkToPem(text, passphrase) {
  const lines = text.replace(/\r/g, '').split('\n');
  const header = /^PuTTY-User-Key-File-([23]): (\S+)$/.exec(lines[0] || '');
  if (!header) throw new KeyError('Not a valid PPK file', 'MALFORMED');
  const version = Number(header[1]);
  const algo = header[2];
  const fields = {};
  let publicB64 = '', privateB64 = '';
  for (let i = 1; i < lines.length; i++) {
    const m = /^([A-Za-z0-9-]+): ?(.*)$/.exec(lines[i]);
    if (!m) continue;
    fields[m[1]] = m[2];
    if (m[1] === 'Public-Lines') { const n = +m[2]; publicB64 = lines.slice(i + 1, i + 1 + n).join(''); i += n; }
    else if (m[1] === 'Private-Lines') { const n = +m[2]; privateB64 = lines.slice(i + 1, i + 1 + n).join(''); i += n; }
  }
  const encryption = fields['Encryption'];
  const comment = fields['Comment'] || '';
  const pub = Buffer.from(publicB64, 'base64');
  let priv = Buffer.from(privateB64, 'base64');
  const encrypted = encryption !== 'none';
  if (encrypted && encryption !== 'aes256-cbc') throw new KeyError('Unsupported PPK encryption: ' + encryption, 'UNSUPPORTED');
  if (encrypted && !passphrase) throw new KeyError('This PPK key is protected by a passphrase', 'PASSPHRASE');
  const pass = Buffer.from(passphrase || '', 'utf8');

  let cipherKey, iv, macKey;
  if (version === 3) {
    if (encrypted) {
      const d = await argon2Derive(fields['Key-Derivation'], +fields['Argon2-Memory'], +fields['Argon2-Passes'],
        +fields['Argon2-Parallelism'], Buffer.from(fields['Argon2-Salt'], 'hex'), pass);
      cipherKey = d.subarray(0, 32); iv = d.subarray(32, 48); macKey = d.subarray(48, 80);
    } else macKey = Buffer.alloc(0);
  } else {
    if (encrypted) {
      const sha1 = (...p) => crypto.createHash('sha1').update(Buffer.concat(p)).digest();
      cipherKey = Buffer.concat([sha1(Buffer.from([0, 0, 0, 0]), pass), sha1(Buffer.from([0, 0, 0, 1]), pass)]).subarray(0, 32);
      iv = Buffer.alloc(16);
    }
    macKey = crypto.createHash('sha1').update('putty-private-key-file-mac-key').update(pass).digest();
  }
  if (encrypted) {
    const dec = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv); dec.setAutoPadding(false);
    priv = Buffer.concat([dec.update(priv), dec.final()]);
  }
  // Integrity / passphrase check
  const macData = Buffer.concat([sshString(Buffer.from(algo)), sshString(Buffer.from(encryption)),
    sshString(Buffer.from(comment)), sshString(pub), sshString(priv)]);
  const expected = hmac(version === 3 ? 'sha256' : 'sha1', macKey, macData).toString('hex');
  if (expected !== (fields['Private-MAC'] || '').toLowerCase()) {
    throw new KeyError(encrypted ? 'Wrong passphrase for this PPK key' : 'PPK integrity check failed', encrypted ? 'BADPASSPHRASE' : 'MALFORMED');
  }

  const pr = reader(pub), vr = reader(priv);
  const keyType = pr.string().toString();
  if (keyType === 'ssh-rsa') {
    const e = stripZeros(pr.string()), n = stripZeros(pr.string());
    const d = stripZeros(vr.string()), p = stripZeros(vr.string()), q = stripZeros(vr.string()), qi = stripZeros(vr.string());
    const D = toBig(d), P = toBig(p), Q = toBig(q);
    const jwk = { kty: 'RSA', n: b64u(n), e: b64u(e), d: b64u(d), p: b64u(p), q: b64u(q),
      dp: b64u(bigToBuf(D % (P - 1n))), dq: b64u(bigToBuf(D % (Q - 1n))),
      qi: b64u(qi) };
    return crypto.createPrivateKey({ key: jwk, format: 'jwk' }).export({ type: 'pkcs1', format: 'pem' });
  }
  if (keyType === 'ssh-ed25519') {
    const x = pr.string();
    const mp = vr.string();
    // PuTTY stores the 32-byte seed as a little-endian integer written as an mpint.
    const candidates = [];
    const le = Buffer.alloc(32); let v = toBig(mp);
    for (let i = 0; i < 32; i++) { le[i] = Number(v & 0xffn); v >>= 8n; }
    candidates.push(le, Buffer.concat([Buffer.alloc(Math.max(0, 32 - stripZeros(mp).length)), stripZeros(mp)]).subarray(-32));
    for (const seed of candidates) {
      try {
        const k = crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: b64u(seed), x: b64u(x) }, format: 'jwk' });
        const derived = crypto.createPublicKey(k).export({ format: 'jwk' }).x;
        if (derived === b64u(x)) return ed25519OpenSsh(seed, x, comment);
      } catch (_) { /* try next */ }
    }
    throw new KeyError('Could not read ed25519 private key from PPK', 'MALFORMED');
  }
  if (/^ecdsa-sha2-nistp(256|384|521)$/.test(keyType)) {
    const curve = pr.string().toString(); const point = pr.string();
    const crv = { nistp256: 'P-256', nistp384: 'P-384', nistp521: 'P-521' }[curve];
    const size = { 'P-256': 32, 'P-384': 48, 'P-521': 66 }[crv];
    const d = stripZeros(vr.string());
    const dPad = Buffer.concat([Buffer.alloc(size - d.length), d]);
    const jwk = { kty: 'EC', crv, x: b64u(point.subarray(1, 1 + size)), y: b64u(point.subarray(1 + size)), d: b64u(dPad) };
    return crypto.createPrivateKey({ key: jwk, format: 'jwk' }).export({ type: 'sec1', format: 'pem' });
  }
  throw new KeyError('Unsupported PPK key type: ' + keyType, 'UNSUPPORTED');
}

/**
 * Returns { privateKey: string|Buffer } ready for ssh2.
 * Throws KeyError with code PASSPHRASE (needs a passphrase) or BADPASSPHRASE / MALFORMED / UNSUPPORTED.
 */
async function loadPrivateKey(filePath, passphrase) {
  let raw;
  try { raw = fs.readFileSync(filePath); } catch (e) { throw new KeyError('Cannot read key file: ' + e.message, 'READ'); }
  const text = raw.toString('utf8');
  if (isPpk(text)) {
    const pem = await ppkToPem(text, passphrase);
    return { privateKey: pem };
  }
  const parsed = utils.parseKey(raw, passphrase || undefined);
  const err = Array.isArray(parsed) ? parsed[0] : parsed;
  if (err instanceof Error) {
    if (/passphrase/i.test(err.message) && !passphrase) throw new KeyError('This key is protected by a passphrase', 'PASSPHRASE');
    if (/passphrase|bad decrypt|integrity|decrypt/i.test(err.message)) throw new KeyError('Wrong passphrase for this key', 'BADPASSPHRASE');
    throw new KeyError('Unsupported or invalid key file: ' + err.message, 'MALFORMED');
  }
  return { privateKey: raw, passphrase: passphrase || undefined };
}

module.exports = { loadPrivateKey, isPpk, KeyError };
