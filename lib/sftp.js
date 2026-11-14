'use strict';
// SFTP file manager back end: list, upload and download files or whole folders, plus mkdir / rename / delete.
// Runs over the SSH connection that already exists for a tab (no second login).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const posix = path.posix;
const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFREG = 0o100000, S_IFLNK = 0o120000;
const MAX_ENTRIES = 200000;
const kind = (mode) => { const t = mode & S_IFMT; return t === S_IFDIR ? 'dir' : t === S_IFLNK ? 'link' : t === S_IFREG ? 'file' : 'other'; };
const call = (obj, method, ...args) => new Promise((resolve, reject) => obj[method](...args, (err, res) => (err ? reject(err) : resolve(res))));

// A file name coming from a server is untrusted: never let it climb out of the folder we are writing into.
function safeName(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\/\\\0]/.test(name)) {
    throw new Error(`Refusing unsafe file name: ${JSON.stringify(String(name).slice(0, 80))}`);
  }
  return name;
}
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
function localName(name, platform = process.platform) {
  safeName(name);
  if (platform !== 'win32') return name;
  let n = name.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '_');
  if (WIN_RESERVED.test(n)) n = '_' + n;
  return n;
}
function resolveInside(root, relPosix) {
  const full = path.join(root, ...relPosix.split('/').filter(Boolean).map((p) => localName(p)));
  const base = path.resolve(root);
  if (full !== base && !path.resolve(full).startsWith(base + path.sep)) throw new Error('Path escapes the destination folder');
  return full;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } });
  await Promise.all(workers);
}

// ---------------------------------------------------------------- listing
async function listDir(sftp, p) {
  const real = await call(sftp, 'realpath', p || '.');
  const raw = await call(sftp, 'readdir', real);
  const entries = [];
  for (const it of raw) {
    if (it.filename === '.' || it.filename === '..') continue;
    try { safeName(it.filename); } catch (_) { continue; }
    entries.push({ name: it.filename, type: kind(it.attrs.mode), size: it.attrs.size || 0, mtime: it.attrs.mtime || 0, mode: it.attrs.mode & 0o7777, link: false });
  }
  await mapLimit(entries.filter((e) => e.type === 'link'), 8, async (e) => {
    e.link = true;
    try { const st = await call(sftp, 'stat', posix.join(real, e.name)); e.type = kind(st.mode); e.size = st.size || 0; }
    catch (_) { e.type = 'other'; e.broken = true; }
  });
  return { path: real, entries };
}

// ---------------------------------------------------------------- scanning
async function scanRemote(sftp, abs, rel, out) {
  for (const it of await call(sftp, 'readdir', abs)) {
    if (it.filename === '.' || it.filename === '..') continue;
    const name = safeName(it.filename);
    const r = rel ? `${rel}/${name}` : name;
    if (++out.count > MAX_ENTRIES) throw new Error('Too many files (limit is 200,000 per transfer).');
    const t = kind(it.attrs.mode);
    if (t === 'dir') { out.dirs.push(r); await scanRemote(sftp, posix.join(abs, name), r, out); }
    else if (t === 'file') { out.files.push({ src: posix.join(abs, name), rel: r, size: it.attrs.size || 0, mtime: it.attrs.mtime || 0, mode: it.attrs.mode & 0o777 }); out.total += it.attrs.size || 0; }
    else out.skipped.push(r);                                  // symlinks and special files are not followed inside folders
  }
}
async function scanLocal(abs, rel, out) {
  for (const d of await fsp.readdir(abs, { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (++out.count > MAX_ENTRIES) throw new Error('Too many files (limit is 200,000 per transfer).');
    const full = path.join(abs, d.name);
    if (d.isDirectory()) { out.dirs.push(r); await scanLocal(full, r, out); }
    else if (d.isFile()) { const st = await fsp.stat(full); out.files.push({ src: full, rel: r, size: st.size, mtime: Math.floor(st.mtimeMs / 1000), mode: st.mode & 0o777 }); out.total += st.size; }
    else out.skipped.push(r);
  }
}

// ---------------------------------------------------------------- transfer engine
// 128 requests of 32 KB in flight: ~4 MB window, works with OpenSSH, Windows OpenSSH and most other servers.
const FAST = { concurrency: 128, chunkSize: 32768 };

function register({ ipcMain, dialog, getWin, send, getConn }) {
  const jobs = new Map();

  function getSftp(id) {
    const c = getConn(id);
    if (!c || !c.ready) return Promise.reject(new Error('This session is not connected.'));
    if (!c.sftpP) {
      c.sftpP = new Promise((resolve, reject) => c.client.sftp((err, s) => {
        if (err) { c.sftpP = null; return reject(err); }
        s.on('close', () => { c.sftpP = null; });
        resolve(s);
      }));
    }
    return c.sftpP;
  }
  const guard = (fn) => async (_e, req) => {
    try { return await fn(req || {}); } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
  };
  const askConflict = async (names, where) => {
    const r = await dialog.showMessageBox(getWin() || undefined, {
      type: 'question', buttons: ['Overwrite', 'Skip existing', 'Cancel'], defaultId: 1, cancelId: 2, title: 'Files already exist',
      message: `${names.length} item${names.length > 1 ? 's' : ''} already exist${names.length > 1 ? '' : 's'} in ${where}.`,
      detail: names.slice(0, 8).join('\n') + (names.length > 8 ? `\n…and ${names.length - 8} more` : '')
    });
    return ['overwrite', 'skip', 'cancel'][r.response];
  };

  // Every transfer gets its own SFTP channel, so cancelling one never disturbs browsing or other transfers.
  const openChannel = (id) => new Promise((resolve, reject) => {
    const c = getConn(id);
    if (!c || !c.ready) return reject(new Error('This session is not connected.'));
    c.client.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });

  function newJob(id, kindName, label, destination) {
    const job = { jobId: crypto.randomUUID(), id, kind: kindName, label, destination, state: 'scanning', bytes: 0, total: 0, files: 0, filesTotal: 0, current: '', skipped: 0, error: '', abort: new AbortController(), last: 0 };
    jobs.set(job.jobId, job);
    return job;
  }
  const publish = (job, force) => {
    const now = Date.now();
    if (!force && now - job.last < 120) return;
    job.last = now;
    const { jobId, id, kind: k, label, destination, state, bytes, total, files, filesTotal, current, skipped, error } = job;
    send('sftp:progress', { jobId, id, kind: k, label, destination, state, bytes, total, files, filesTotal, current, skipped, error });
  };
  const finish = (job, state, error) => { try { if (job.sftp) job.sftp.end(); } catch (_) { /* already closed */ } job.state = state; job.error = error || ''; job.current = ''; publish(job, true); jobs.delete(job.jobId); };

  async function transfer(job, plan, copyOne, mkdirs) {
    try {
      job.total = plan.total; job.filesTotal = plan.files.length; job.skipped = plan.skipped.length; job.state = 'running'; publish(job, true);
      await mkdirs();
      for (const f of plan.files) {
        if (job.abort.signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        job.current = f.rel; publish(job);
        await copyOne(f);
        job.files++; publish(job);
      }
      finish(job, 'done');
    } catch (e) {
      if (e && (e.name === 'AbortError' || job.abort.signal.aborted)) finish(job, 'cancelled');
      else finish(job, 'error', String(e && e.message || e));
    }
  }

  // ---- download: remote files / folders -> a local folder
  ipcMain.handle('sftp:download', guard(async ({ id, remoteDir, items }) => {
    if (!Array.isArray(items) || !items.length) return { ok: false, message: 'Nothing selected.' };
    const sftp = await getSftp(id);
    const pick = await dialog.showOpenDialog(getWin() || undefined, { title: 'Choose where to save', properties: ['openDirectory', 'createDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };
    const dest = pick.filePaths[0];
    const names = items.map((i) => safeName(i.name));
    const clash = names.filter((n) => fs.existsSync(path.join(dest, localName(n))));
    let policy = 'overwrite';
    if (clash.length) { policy = await askConflict(clash, dest); if (policy === 'cancel') return { ok: false, canceled: true }; }
    const job = newJob(id, 'download', names.length === 1 ? names[0] : `${names.length} items`, dest);
    publish(job, true);
    (async () => {
      try {
        const js = job.sftp = await openChannel(id);
        job.abort.signal.addEventListener('abort', () => { try { js.end(); } catch (_) { /* ignore */ } }, { once: true });
        const plan = { files: [], dirs: [], skipped: [], total: 0, count: 0 };
        for (const n of names) {
          const abs = posix.join(remoteDir, n);
          const st = await call(js, 'stat', abs);                    // follows a top-level symlink
          const t = kind(st.mode);
          if (t === 'dir') { plan.dirs.push(n); await scanRemote(js, abs, n, plan); }
          else if (t === 'file') { plan.files.push({ src: abs, rel: n, size: st.size || 0, mtime: st.mtime || 0, mode: st.mode & 0o777 }); plan.total += st.size || 0; }
          else plan.skipped.push(n);
        }
        await transfer(job, plan, async (f) => {
          const local = resolveInside(dest, f.rel);
          if (policy === 'skip' && fs.existsSync(local)) { job.bytes += f.size; return; }
          let last = 0;
          try {
            await new Promise((resolve, reject) => js.fastGet(f.src, local, { ...FAST, step: (done) => { job.bytes += done - last; last = done; publish(job); } }, (e) => (e ? reject(e) : resolve())));
            if (f.mtime) await fsp.utimes(local, f.mtime, f.mtime).catch(() => {});
          } catch (e) { await fsp.rm(local, { force: true }).catch(() => {}); throw job.abort.signal.aborted ? Object.assign(new Error('Cancelled'), { name: 'AbortError' }) : e; }
        }, async () => { for (const d of plan.dirs) await fsp.mkdir(resolveInside(dest, d), { recursive: true }); });
      } catch (e) { finish(job, 'error', String(e && e.message || e)); }
    })();
    return { ok: true, jobId: job.jobId };
  }));

  // ---- upload: local files / folders -> a remote folder
  ipcMain.handle('sftp:upload', guard(async ({ id, remoteDir, mode, paths }) => {
    const sftp = await getSftp(id);
    let sources = [];
    if (mode === 'paths') sources = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && path.isAbsolute(p));
    else {
      const pick = await dialog.showOpenDialog(getWin() || undefined, mode === 'folder'
        ? { title: 'Choose a folder to upload', properties: ['openDirectory'] }
        : { title: 'Choose files to upload', properties: ['openFile', 'multiSelections'] });
      if (pick.canceled) return { ok: false, canceled: true };
      sources = pick.filePaths;
    }
    if (!sources.length) return { ok: false, message: 'Nothing to upload.' };
    const names = sources.map((s) => safeName(path.basename(s)));
    const clash = [];
    for (const n of names) { try { await call(sftp, 'stat', posix.join(remoteDir, n)); clash.push(n); } catch (_) { /* does not exist */ } }
    let policy = 'overwrite';
    if (clash.length) { policy = await askConflict(clash, remoteDir); if (policy === 'cancel') return { ok: false, canceled: true }; }
    const job = newJob(id, 'upload', names.length === 1 ? names[0] : `${names.length} items`, remoteDir);
    publish(job, true);
    (async () => {
      try {
        const js = job.sftp = await openChannel(id);
        job.abort.signal.addEventListener('abort', () => { try { js.end(); } catch (_) { /* ignore */ } }, { once: true });
        const plan = { files: [], dirs: [], skipped: [], total: 0, count: 0 };
        for (let i = 0; i < sources.length; i++) {
          const st = await fsp.stat(sources[i]);
          if (st.isDirectory()) { plan.dirs.push(names[i]); await scanLocal(sources[i], names[i], plan); }
          else if (st.isFile()) { plan.files.push({ src: sources[i], rel: names[i], size: st.size, mtime: Math.floor(st.mtimeMs / 1000), mode: st.mode & 0o777 }); plan.total += st.size; }
          else plan.skipped.push(names[i]);
        }
        plan.dirs.sort((a, b) => a.split('/').length - b.split('/').length);
        const remoteOf = (rel) => posix.join(remoteDir, ...rel.split('/').map(safeName));
        await transfer(job, plan, async (f) => {
          const dst = remoteOf(f.rel);
          if (policy === 'skip') { try { await call(js, 'stat', dst); job.bytes += f.size; return; } catch (_) { /* upload it */ } }
          let last = 0;
          try {
            await new Promise((resolve, reject) => js.fastPut(f.src, dst, { ...FAST, mode: f.mode || 0o644, step: (done) => { job.bytes += done - last; last = done; publish(job); } }, (e) => (e ? reject(e) : resolve())));
            if (f.mtime) await call(js, 'utimes', dst, f.mtime, f.mtime).catch(() => {});
          } catch (e) {
            if (job.abort.signal.aborted) { await call(await openChannel(id), 'unlink', dst).catch(() => {}); throw Object.assign(new Error('Cancelled'), { name: 'AbortError' }); }
            await call(js, 'unlink', dst).catch(() => {}); throw e;
          }
        }, async () => {
          for (const d of plan.dirs) {
            const abs = remoteOf(d);
            try { const st = await call(js, 'stat', abs); if (kind(st.mode) !== 'dir') throw new Error(`${abs} exists and is not a folder`); }
            catch (e) { if (/not a folder/.test(e.message)) throw e; await call(js, 'mkdir', abs); }
          }
        });
      } catch (e) { finish(job, 'error', String(e && e.message || e)); }
    })();
    return { ok: true, jobId: job.jobId };
  }));

  ipcMain.handle('sftp:list', guard(async ({ id, path: p }) => ({ ok: true, ...(await listDir(await getSftp(id), typeof p === 'string' ? p : '')) })));
  ipcMain.handle('sftp:mkdir', guard(async ({ id, dir, name }) => { const s = await getSftp(id); await call(s, 'mkdir', posix.join(dir, safeName(name))); return { ok: true }; }));
  ipcMain.handle('sftp:rename', guard(async ({ id, dir, from, to }) => {
    const s = await getSftp(id); await call(s, 'rename', posix.join(dir, safeName(from)), posix.join(dir, safeName(to))); return { ok: true };
  }));
  ipcMain.handle('sftp:remove', guard(async ({ id, dir, items }) => {
    const s = await getSftp(id);
    const rm = async (abs) => {
      const st = await call(s, 'lstat', abs);
      if (kind(st.mode) === 'dir') {
        for (const it of await call(s, 'readdir', abs)) { if (it.filename === '.' || it.filename === '..') continue; await rm(posix.join(abs, safeName(it.filename))); }
        await call(s, 'rmdir', abs);
      } else await call(s, 'unlink', abs);
    };
    for (const i of items || []) await rm(posix.join(dir, safeName(i.name)));
    return { ok: true };
  }));
  ipcMain.on('sftp:cancel', (_e, jobId) => { const j = jobs.get(jobId); if (j) j.abort.abort(); });

  return { cancelFor: (id) => { for (const j of jobs.values()) if (j.id === id) j.abort.abort(); } };
}

module.exports = { register, safeName, localName, resolveInside, kind };
