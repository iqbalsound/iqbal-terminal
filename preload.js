'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const listen = (ch) => (cb) => {
  const h = (_e, ...a) => cb(...a);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};
contextBridge.exposeInMainWorld('api', {
  settings: { get: invoke('settings:get'), set: invoke('settings:set') },
  sessions: { list: invoke('sessions:list'), save: invoke('sessions:save'), remove: invoke('sessions:remove'), export: invoke('sessions:export'), import: invoke('sessions:import') },
  pickKey: invoke('dialog:pickKey'),
  clipboard: { read: invoke('clipboard:read'), write: invoke('clipboard:write') },
  clearKnownHosts: invoke('hosts:clear'),
  info: invoke('app:info'),
  connect: invoke('ssh:connect'),
  write: (id, data) => ipcRenderer.send('ssh:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('ssh:resize', id, cols, rows),
  disconnect: (id) => ipcRenderer.send('ssh:disconnect', id),
  kbdReply: (reqId, answers) => ipcRenderer.send('ssh:kbd-reply', reqId, answers),
  openExternal: (url) => ipcRenderer.send('app:open-external', url),
  hide: () => ipcRenderer.send('app:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  openDataDir: () => ipcRenderer.send('app:open-data-dir'),
  pip: { open: invoke('pip:open'), init: invoke('pip:init'), dock: (id, payload) => ipcRenderer.send('pip:dock', id, payload),
    askDock: (id) => ipcRenderer.send('pip:ask-dock', id),
    setOnTop: (f) => ipcRenderer.send('pip:set-on-top', f), setOpacity: (v) => ipcRenderer.send('pip:set-opacity', v) },
  sftp: { list: invoke('sftp:list'), download: invoke('sftp:download'), upload: invoke('sftp:upload'), mkdir: invoke('sftp:mkdir'), rename: invoke('sftp:rename'),
    remove: invoke('sftp:remove'), cancel: (jobId) => ipcRenderer.send('sftp:cancel', jobId) },
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch (_) { return ''; } },
  onSftpProgress: listen('sftp:progress'),
  file: { open: invoke('file:open'), save: invoke('file:save') },
  onDocked: listen('pip:docked'), onRequestDock: listen('pip:request-dock'),
  onData: listen('ssh:data'), onClosed: listen('ssh:closed'), onKbd: listen('ssh:kbd'), onNewSession: listen('ui:new-session')
});
