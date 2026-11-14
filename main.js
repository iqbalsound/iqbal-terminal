'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, safeStorage, nativeImage, clipboard, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('ssh2');
const { loadPrivateKey, KeyError } = require('./lib/keys');

app.setName('Iqbal Terminal');
const APP_TITLE = 'Iqbal Terminal';
const ICON = path.join(__dirname, 'assets', 'icon.png');

let win = null;
let tray = null;
let quitting = false;
const conns = new Map();       // tab id -> { client, stream, ready, ... }
const pipWins = new Map();     // tab id -> floating (PiP) BrowserWindow
const pipInit = new Map();     // tab id -> data used to seed a PiP terminal
const pkg = require('./package.json');
let sftpApi = { cancelFor() {} };
const pendingKbd = new Map();  // request id -> callback

// ------------------------------------------------------------------ storage
const userFile = (name) => path.join(app.getPath('userData'), name);
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(userFile(name), 'utf8')); } catch (_) { return fallback; }
}
function writeJson(name, data) {
  const file = userFile(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const DEFAULT_SETTINGS = {
  uiTheme: 'dark', termScheme: 'auto', fontFamily: 'JetBrains Mono', fontSize: 14, lineHeight: 1.15,
  cursorStyle: 'block', cursorBlink: true, scrollback: 10000, copyOnSelect: false, rightClick: 'menu',
  closeToTray: true, keepAlive: 30, sidebarWidth: 270, sidebarOpen: true
};
const getSettings = () => ({ ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) });

// Passwords / passphrases are only stored when the OS can encrypt them (DPAPI, Keychain, libsecret, KWallet).
function secretsAvailable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend &&
        safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
    return true;
  } catch (_) { return false; }
}
const encrypt = (s) => safeStorage.encryptString(s).toString('base64');
const decrypt = (s) => { try { return safeStorage.decryptString(Buffer.from(s, 'base64')); } catch (_) { return undefined; } };

const str = (v, max = 512) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function sanitizeSession(s) {
  const port = parseInt(s.port, 10);
  const out = {
    id: str(s.id, 64) || crypto.randomUUID(),
    name: str(s.name, 120), group: str(s.group, 80),
    host: str(s.host, 255), port: port >= 1 && port <= 65535 ? port : 22,
    username: str(s.username, 128),
    auth: ['password', 'key', 'agent'].includes(s.auth) ? s.auth : 'password',
    keyPath: str(s.keyPath, 1024), startupCommand: str(s.startupCommand, 1024)
  };
  if (!out.name) out.name = out.username ? `${out.username}@${out.host}` : out.host;
  return out;
}
const publicSession = (s) => {
  const { pw, pp, ...rest } = s;
  return { ...rest, hasPassword: !!pw, hasPassphrase: !!pp };
};

// ------------------------------------------------------------------ window & tray
function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}
// Output of a session goes to its PiP window while one is open, otherwise to the main window.
function sendConn(id, channel, ...args) {
  const init = pipInit.get(id);
  if (init && init.waiting) { init.pending.push([channel, args]); return; }   // PiP page still loading
  const pip = pipWins.get(id);
  const target = pip && !pip.isDestroyed() ? pip : win;
  if (target && !target.isDestroyed()) target.webContents.send(channel, ...args);
}
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function confirmQuit() {
  if (conns.size === 0) return true;
  const r = dialog.showMessageBoxSync(win && win.isVisible() ? win : undefined, {
    type: 'warning', buttons: ['Quit and disconnect', 'Cancel'], defaultId: 1, cancelId: 1,
    title: 'Quit Iqbal Terminal',
    message: `${conns.size} SSH session${conns.size > 1 ? 's are' : ' is'} still open.`,
    detail: 'Quitting will disconnect all of them.'
  });
  return r === 0;
}
function requestQuit() {
  if (!confirmQuit()) return;
  quitting = true;
  app.quit();
}
function updateTray() {
  if (!tray) return;
  const n = conns.size;
  tray.setToolTip(`${APP_TITLE} — ${n} active session${n === 1 ? '' : 's'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: win && win.isVisible() ? 'Hide window' : 'Show window', click: () => (win.isVisible() ? win.hide() : showWindow()) },
    { label: 'New session…', click: () => { showWindow(); send('ui:new-session'); } },
    { type: 'separator' },
    { label: `${n} active session${n === 1 ? '' : 's'}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: requestQuit }
  ]));
}
function createTray() {
  try {
    const size = process.platform === 'win32' ? 16 : 22;
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: size, height: size }));
    tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
    tray.on('double-click', showWindow);
    updateTray();
  } catch (e) { tray = null; }
}

function createWindow() {
  const settings = getSettings();
  const saved = readJson('window.json', {});
  const area = screen.getPrimaryDisplay().workArea;
  const fits = saved.width && saved.height && saved.x !== undefined &&
    saved.x < area.x + area.width - 100 && saved.y < area.y + area.height - 100 && saved.x + saved.width > area.x + 100 && saved.y + saved.height > area.y + 50;
  win = new BrowserWindow({
    width: saved.width || 1200, height: saved.height || 760, ...(fits ? { x: saved.x, y: saved.y } : {}),
    minWidth: 620, minHeight: 380, show: false, title: APP_TITLE, icon: ICON, resizable: true,
    backgroundColor: settings.uiTheme === 'light' ? '#ffffff' : settings.uiTheme === 'matrix' ? '#000000' : '#0d1117',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  win.setMenuBarVisibility(false);
  if (saved.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  let timer;
  const saveBounds = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
      const maximized = win.isMaximized();
      const b = maximized ? (readJson('window.json', {})) : win.getBounds();
      writeJson('window.json', { ...b, maximized });
    }, 400);
  };
  win.on('resize', saveBounds); win.on('move', saveBounds); win.on('maximize', saveBounds); win.on('unmaximize', saveBounds);
  win.on('show', updateTray); win.on('hide', updateTray);

  win.on('close', (e) => {
    if (quitting) return;
    if (getSettings().closeToTray && tray) { e.preventDefault(); win.hide(); return; }
    if (!confirmQuit()) { e.preventDefault(); return; }
    quitting = true;
  });
  win.on('closed', () => { win = null; });

  // Never navigate away from the app; open web links in the default browser.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ------------------------------------------------------------------ SSH
const friendlyError = (err) => {
  const m = err && err.message ? err.message : String(err);
  if (err && err.code === 'ENOTFOUND') return 'Host not found (check the host name)';
  if (err && err.code === 'ECONNREFUSED') return 'Connection refused (is SSH running on that port?)';
  if (err && (err.code === 'ETIMEDOUT' || /timed out/i.test(m))) return 'Connection timed out';
  if (err && err.code === 'EHOSTUNREACH') return 'Host unreachable';
  if (err && err.code === 'ECONNRESET') return 'Connection reset by the server';
  if (/All configured authentication methods failed/i.test(m)) return 'Authentication failed';
  return m;
};

function hostKeyFingerprint(hex) { return 'SHA256:' + Buffer.from(hex, 'hex').toString('base64').replace(/=+$/, ''); }

async function verifyHost(host, port, fp) {
  const known = readJson('known_hosts.json', {});
  const key = `${host.toLowerCase()}:${port}`;
  if (known[key] === fp) return true;
  showWindow();
  const parent = win && win.isVisible() ? win : undefined;
  if (!known[key]) {
    const r = await dialog.showMessageBox(parent, {
      type: 'question', buttons: ['Trust and save', 'Connect once', 'Cancel'], defaultId: 2, cancelId: 2,
      title: 'New host key', message: `The authenticity of ${host}:${port} can't be verified.`,
      detail: `Host key fingerprint:\n${fp}\n\nOnly continue if you recognize this fingerprint.`
    });
    if (r.response === 0) { known[key] = fp; writeJson('known_hosts.json', known); return true; }
    return r.response === 1;
  }
  const r = await dialog.showMessageBox(parent, {
    type: 'warning', buttons: ['Cancel', 'Replace key and connect'], defaultId: 0, cancelId: 0,
    title: 'WARNING: host key changed', message: `The host key for ${host}:${port} has CHANGED.`,
    detail: `Saved:  ${known[key]}\nNow:    ${fp}\n\nThis can mean the server was reinstalled, or that someone is intercepting your connection.`
  });
  if (r.response === 1) { known[key] = fp; writeJson('known_hosts.json', known); return true; }
  return false;
}

function agentPath() {
  if (process.platform === 'win32') {
    const pipe = '\\\\.\\pipe\\openssh-ssh-agent';
    try { if (fs.existsSync(pipe)) return pipe; } catch (_) { /* ignore */ }
    return 'pageant';
  }
  return process.env.SSH_AUTH_SOCK || null;
}

function dropConn(id, reason) {
  const c = conns.get(id);
  if (!c) return;
  conns.delete(id);
  sftpApi.cancelFor(id);
  try { c.client.end(); } catch (_) { /* ignore */ }
  if (c.ready) sendConn(id, 'ssh:closed', { id, reason: reason || '' });
  updateTray();
}

ipcMain.handle('ssh:connect', async (_e, req) => {
  const { id, sessionId, params = {}, secrets = {}, remember = false, cols = 80, rows = 24 } = req || {};
  if (!id) return { ok: false, message: 'Missing tab id' };
  const p = sanitizeSession(params);
  if (!p.host) return { ok: false, message: 'Host is required' };
  if (!p.username) return { ok: false, message: 'User name is required' };

  const stored = sessionId ? (readJson('sessions.json', []).find((s) => s.id === sessionId) || {}) : {};
  const password = secrets.password != null ? secrets.password : (stored.pw ? decrypt(stored.pw) : undefined);
  const passphrase = secrets.passphrase != null ? secrets.passphrase : (stored.pp ? decrypt(stored.pp) : undefined);
  const settings = getSettings();

  if (conns.has(id)) dropConn(id);
  const cfg = {
    host: p.host, port: p.port, username: p.username, readyTimeout: 20000, tryKeyboard: true, hostHash: 'sha256',
    keepaliveInterval: Math.max(0, settings.keepAlive | 0) * 1000, keepaliveCountMax: 4
  };
  if (p.auth === 'key') {
    if (!p.keyPath) return { ok: false, message: 'Choose a private key file (PEM, OpenSSH or PPK)' };
    try { Object.assign(cfg, await loadPrivateKey(p.keyPath, passphrase)); }
    catch (e) {
      if (e instanceof KeyError && (e.code === 'PASSPHRASE' || e.code === 'BADPASSPHRASE')) return { ok: false, needs: 'passphrase', message: e.message };
      return { ok: false, message: e.message };
    }
  } else if (p.auth === 'agent') {
    cfg.agent = agentPath();
    if (!cfg.agent) return { ok: false, message: 'No SSH agent found (SSH_AUTH_SOCK is not set)' };
  } else {
    if (!password) return { ok: false, needs: 'password' };
    cfg.password = password;
  }

  const client = new Client();
  const conn = { client, stream: null, ready: false, fp: '' };
  conns.set(id, conn);
  updateTray();

  cfg.hostVerifier = (hashHex, cb) => {
    conn.fp = hostKeyFingerprint(hashHex);
    verifyHost(p.host, p.port, conn.fp).then(cb, () => cb(false));
  };

  const result = await new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };

    client.on('keyboard-interactive', (name, instructions, _lang, prompts, finish) => {
      if (prompts.length === 1 && /password/i.test(prompts[0].prompt) && password) return finish([password]);
      if (prompts.length === 0) return finish([]);
      const reqId = crypto.randomUUID();
      pendingKbd.set(reqId, finish);
      showWindow();
      send('ssh:kbd', { id, reqId, name, instructions, prompts });
    });
    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols, rows, width: 0, height: 0 }, (err, stream) => {
        if (err) return done({ ok: false, message: friendlyError(err) });
        conn.stream = stream; conn.ready = true;
        stream.on('data', (d) => sendConn(id, 'ssh:data', id, d));
        if (stream.stderr) stream.stderr.on('data', (d) => sendConn(id, 'ssh:data', id, d));
        stream.on('close', () => dropConn(id, 'Session ended by the server'));
        done({ ok: true, fingerprint: conn.fp });
        if (p.startupCommand) stream.write(p.startupCommand + '\n');
      });
    });
    client.on('error', (err) => {
      const message = friendlyError(err);
      done({ ok: false, message, authFailed: message === 'Authentication failed' });
      dropConn(id, message);
    });
    client.on('close', () => { done({ ok: false, message: 'Connection closed before login completed' }); dropConn(id, 'Connection closed'); });
    try { client.connect(cfg); } catch (e) { done({ ok: false, message: friendlyError(e) }); }
  });

  if (result.ok && remember && sessionId && secretsAvailable()) {
    const list = readJson('sessions.json', []);
    const s = list.find((x) => x.id === sessionId);
    if (s) {
      if (secrets.password) s.pw = encrypt(secrets.password);
      if (secrets.passphrase) s.pp = encrypt(secrets.passphrase);
      writeJson('sessions.json', list);
    }
  }
  if (!result.ok) {
    if (conns.get(id) === conn) { conns.delete(id); updateTray(); }
    if (result.authFailed && p.auth === 'password') return { ok: false, needs: 'password', message: 'Authentication failed — check the password' };
  }
  return result;
});

ipcMain.on('ssh:write', (_e, id, data) => {
  const c = conns.get(id);
  if (c && c.stream && !c.stream.destroyed) c.stream.write(data);
});
ipcMain.on('ssh:resize', (_e, id, cols, rows) => {
  const c = conns.get(id);
  if (c && c.stream && !c.stream.destroyed && cols > 0 && rows > 0) c.stream.setWindow(rows, cols, 0, 0);
});
ipcMain.on('ssh:disconnect', (_e, id) => {
  const c = conns.get(id);
  if (c) { c.ready = false; dropConn(id); }
  const pip = pipWins.get(id);
  if (pip && !pip.isDestroyed()) pip.destroy();
  pipWins.delete(id); pipInit.delete(id);
});
ipcMain.on('ssh:kbd-reply', (_e, reqId, answers) => {
  const cb = pendingKbd.get(reqId);
  if (!cb) return;
  pendingKbd.delete(reqId);
  cb(Array.isArray(answers) ? answers.map(String) : []);
});

// ------------------------------------------------------------------ settings, sessions, misc IPC
ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  const next = { ...getSettings() };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (patch && k in patch && typeof patch[k] === typeof DEFAULT_SETTINGS[k]) next[k] = patch[k];
  }
  writeJson('settings.json', next);
  return next;
});

ipcMain.handle('sessions:list', () => readJson('sessions.json', []).map(publicSession));
ipcMain.handle('sessions:save', (_e, session, secrets = {}) => {
  const clean = sanitizeSession(session || {});
  if (!clean.host) return { ok: false, message: 'Host is required' };
  const list = readJson('sessions.json', []);
  const idx = list.findIndex((x) => x.id === clean.id);
  const prev = idx >= 0 ? list[idx] : {};
  if (prev.pw) clean.pw = prev.pw;
  if (prev.pp) clean.pp = prev.pp;
  if (secrets.clearPassword) delete clean.pw;
  if (secrets.clearPassphrase) delete clean.pp;
  let secretsSkipped = false;
  if (secrets.password || secrets.passphrase) {
    if (secretsAvailable()) {
      if (secrets.password) clean.pw = encrypt(secrets.password);
      if (secrets.passphrase) clean.pp = encrypt(secrets.passphrase);
    } else secretsSkipped = true;
  }
  if (idx >= 0) list[idx] = clean; else list.push(clean);
  writeJson('sessions.json', list);
  return { ok: true, session: publicSession(clean), secretsSkipped };
});
ipcMain.handle('sessions:remove', (_e, id) => {
  writeJson('sessions.json', readJson('sessions.json', []).filter((s) => s.id !== id));
  return true;
});
ipcMain.handle('sessions:export', async () => {
  const r = await dialog.showSaveDialog(win, { title: 'Export sessions', defaultPath: 'iqbal-terminal-sessions.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  const list = readJson('sessions.json', []).map(({ pw, pp, ...s }) => s);   // never export secrets
  fs.writeFileSync(r.filePath, JSON.stringify({ app: 'iqbal-terminal', sessions: list }, null, 2));
  return { ok: true, count: list.length };
});
ipcMain.handle('sessions:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import sessions', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    const incoming = Array.isArray(data) ? data : data.sessions;
    if (!Array.isArray(incoming)) throw new Error('No sessions found in this file');
    const list = readJson('sessions.json', []);
    let added = 0;
    for (const raw of incoming) {
      const s = sanitizeSession({ ...raw, id: undefined });
      if (!s.host) continue;
      list.push(s); added++;
    }
    writeJson('sessions.json', list);
    return { ok: true, count: added };
  } catch (e) { return { ok: false, message: e.message }; }
});
ipcMain.handle('dialog:pickKey', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select private key', properties: ['openFile', 'showHiddenFiles'],
    filters: [{ name: 'Private keys (PEM, PPK, OpenSSH)', extensions: ['pem', 'ppk', 'key'] }, { name: 'All files', extensions: ['*'] }]
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('hosts:clear', () => { writeJson('known_hosts.json', {}); return true; });
ipcMain.handle('app:info', () => ({
  name: APP_TITLE, version: app.getVersion(), platform: process.platform, electron: process.versions.electron,
  chrome: process.versions.chrome, node: process.versions.node, secretsAvailable: secretsAvailable(), dataDir: app.getPath('userData'),
  trayAvailable: !!tray,
  author: (pkg.author && pkg.author.name) || '', email: (pkg.author && pkg.author.email) || '', license: pkg.license || '',
  repo: (pkg.repository && (pkg.repository.url || pkg.repository)) || ''
}));
ipcMain.on('app:open-external', (_e, url) => { if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url)); });
ipcMain.on('app:hide', () => { if (win) win.hide(); });
ipcMain.on('app:quit', requestQuit);
ipcMain.on('app:open-data-dir', () => shell.openPath(app.getPath('userData')));


// ------------------------------------------------------------------ PiP (floating session windows)
function finishDock(id, payload) {
  const pip = pipWins.get(id);
  pipWins.delete(id); pipInit.delete(id);
  send('pip:docked', { id, ...(payload || {}) });
  if (pip && !pip.isDestroyed()) pip.destroy();
  showWindow();
}
ipcMain.handle('pip:open', (_e, data) => {
  const id = data && data.id;
  const c = conns.get(id);
  if (!c || !c.ready) return { ok: false, message: 'The session must be connected before it can float.' };
  const existing = pipWins.get(id);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return { ok: true }; }
  const n = pipWins.size;
  const area = screen.getPrimaryDisplay().workArea;
  const w = 680, h = 420;
  const pip = new BrowserWindow({
    width: w, height: h, x: Math.max(area.x, area.x + area.width - w - 24 - n * 32), y: Math.max(area.y, area.y + area.height - h - 24 - n * 32),
    minWidth: 260, minHeight: 140, show: false, title: `${data.title || 'Session'} (PiP)`, icon: ICON, resizable: true, alwaysOnTop: true,
    backgroundColor: '#0d1117', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  pip.setMenuBarVisibility(false);
  pip.setAlwaysOnTop(true, 'floating');
  pipWins.set(id, pip);
  pipInit.set(id, { title: data.title || 'Session', buffer: data.buffer || '', cols: data.cols, rows: data.rows, waiting: true, pending: [] });
  pip.loadFile(path.join(__dirname, 'renderer', 'pip.html'), { query: { id } });
  pip.once('ready-to-show', () => pip.show());
  pip.webContents.on('will-navigate', (e) => e.preventDefault());
  pip.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  let docking = false;
  pip.on('close', (e) => {
    if (quitting || docking || !pipWins.has(id)) return;
    e.preventDefault(); docking = true;
    pip.webContents.send('pip:request-dock');          // the PiP replies with its screen contents
    setTimeout(() => { if (pipWins.has(id)) finishDock(id, null); }, 900);
  });
  return { ok: true };
});
ipcMain.handle('pip:init', (_e, id) => {
  const i = pipInit.get(id);
  if (!i) return null;
  i.waiting = false;
  const pending = i.pending; i.pending = [];
  return { title: i.title, buffer: i.buffer, cols: i.cols, rows: i.rows, pending };
});
ipcMain.on('pip:dock', (_e, id, payload) => { if (pipWins.has(id)) finishDock(id, payload); });
ipcMain.on('pip:ask-dock', (_e, id) => { const w = pipWins.get(id); if (w && !w.isDestroyed()) w.webContents.send('pip:request-dock'); });
ipcMain.on('pip:set-on-top', (e, flag) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setAlwaysOnTop(!!flag, 'floating'); });
ipcMain.on('pip:set-opacity', (e, v) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setOpacity(Math.min(1, Math.max(0.3, Number(v) || 1))); });

// ------------------------------------------------------------------ editor file dialogs
const EDITOR_FILTERS = {
  md: [{ name: 'Markdown', extensions: ['md', 'markdown'] }, { name: 'All files', extensions: ['*'] }],
  txt: [{ name: 'Plain text', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }],
  html: [{ name: 'HTML', extensions: ['html', 'htm'] }, { name: 'All files', extensions: ['*'] }]
};
ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open document', properties: ['openFile'],
    filters: [{ name: 'Documents', extensions: ['md', 'markdown', 'txt', 'html', 'htm', 'log', 'conf', 'sh', 'yml', 'yaml', 'json'] }, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    const f = r.filePaths[0];
    if (fs.statSync(f).size > 5 * 1024 * 1024) return { ok: false, message: 'File is larger than 5 MB.' };
    return { ok: true, path: f, name: path.basename(f), ext: path.extname(f).slice(1).toLowerCase(), content: fs.readFileSync(f, 'utf8') };
  } catch (e) { return { ok: false, message: e.message }; }
});
ipcMain.handle('file:save', async (_e, req) => {
  const kind = EDITOR_FILTERS[req && req.kind] ? req.kind : 'md';
  const r = await dialog.showSaveDialog(win, { title: 'Save document', defaultPath: String(req.defaultName || `document.${kind}`), filters: EDITOR_FILTERS[kind] });
  if (r.canceled || !r.filePath) return { ok: false };
  try { fs.writeFileSync(r.filePath, String(req.content || ''), 'utf8'); return { ok: true, path: r.filePath, name: path.basename(r.filePath) }; }
  catch (e) { return { ok: false, message: e.message }; }
});

// ------------------------------------------------------------------ lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    sftpApi = require('./lib/sftp').register({ ipcMain, dialog, getWin: () => (win && !win.isDestroyed() ? win : null), send, getConn: (id) => conns.get(id) });
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
  });
  app.on('before-quit', () => { quitting = true; for (const w of pipWins.values()) { if (!w.isDestroyed()) w.destroy(); } for (const id of [...conns.keys()]) { const c = conns.get(id); if (c) c.ready = false; dropConn(id); } });
  app.on('window-all-closed', () => { if (quitting || !tray) app.quit(); });
  app.on('activate', () => { if (!win) createWindow(); else showWindow(); });
}
