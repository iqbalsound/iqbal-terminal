'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const api = window.api;

  // ---------------------------------------------------------------- helpers
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in e && k !== 'list') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  };
  const basename = (p) => String(p || '').split(/[\\/]/).pop();
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

  let settings = {};
  let info = {};
  let sessions = [];
  const tabs = new Map();
  let activeId = null;
  let lastSshId = null;
  const collapsedGroups = new Set();

  // ---------------------------------------------------------------- fonts & themes
  const BUNDLED_FONTS = ['JetBrains Mono', 'Fira Code', 'Source Code Pro', 'IBM Plex Mono', 'Inconsolata'];
  const SYSTEM_FONTS = ['Cascadia Mono', 'Cascadia Code', 'Consolas', 'Menlo', 'Monaco', 'SF Mono', 'DejaVu Sans Mono', 'Liberation Mono',
    'Ubuntu Mono', 'Noto Sans Mono', 'Hack', 'Roboto Mono', 'Fira Mono', 'Lucida Console', 'Courier New'];
  function fontInstalled(name) {
    const ctx = document.createElement('canvas').getContext('2d');
    const sample = 'mmmmmmmmmmlli1WwOo0@';
    const width = (f) => { ctx.font = `72px ${f}`; return ctx.measureText(sample).width; };
    return ['monospace', 'serif', 'sans-serif'].some((b) => width(`"${name}",${b}`) !== width(b));
  }
  const fontStack = (name) => `"${name}", "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Liberation Mono", Menlo, monospace`;
  async function ensureFont(name, size) {
    try { await Promise.all([document.fonts.load(`${size}px "${name}"`), document.fonts.load(`bold ${size}px "${name}"`)]); } catch (_) { /* ignore */ }
  }
  const effectiveUiTheme = () => (settings.uiTheme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.uiTheme);
  function resolveScheme() {
    const list = window.TERM_SCHEMES;
    if (settings.termScheme && settings.termScheme !== 'auto') {
      const f = list.find((s) => s.name === settings.termScheme);
      if (f) return f;
    }
    const auto = { dark: 'Iqbal Dark', light: 'Iqbal Light', matrix: 'Matrix Green' }[effectiveUiTheme()] || 'Iqbal Dark';
    return list.find((s) => s.name === auto);
  }
  function termOptions() {
    return {
      fontFamily: fontStack(settings.fontFamily), fontSize: settings.fontSize, lineHeight: settings.lineHeight,
      cursorBlink: settings.cursorBlink, cursorStyle: settings.cursorStyle, scrollback: settings.scrollback,
      theme: resolveScheme().colors
    };
  }
  async function applySettings() {
    document.documentElement.dataset.theme = effectiveUiTheme();
    $('#btnTheme').textContent = { dark: 'Light', light: 'Matrix', matrix: 'Dark' }[effectiveUiTheme()] || 'Light';
    const scheme = resolveScheme();
    document.documentElement.style.setProperty('--term-bg', scheme.colors.background);
    $('#fontLabel').textContent = settings.fontSize;
    await ensureFont(settings.fontFamily, settings.fontSize);
    const opts = termOptions();
    for (const t of tabs.values()) {
      if (t.kind === 'editor') continue;
      for (const [k, v] of Object.entries(opts)) { if (JSON.stringify(t.term.options[k]) !== JSON.stringify(v)) t.term.options[k] = v; }
    }
    requestAnimationFrame(fitActive);
    updateStatus();
  }
  async function saveSettings(patch) {
    Object.assign(settings, patch);            // apply immediately so rapid key presses accumulate
    await applySettings();
    api.settings.set(patch);
  }
  const setFontSize = (n) => saveSettings({ fontSize: clamp(Math.round(n), 8, 40) });
  function zoomActive(d) { const t = tabs.get(activeId); if (t && t.kind === 'editor') t.editor.zoom(d); else setFontSize(d === 0 ? 14 : settings.fontSize + d); }

  // ---------------------------------------------------------------- modal helpers
  const modalStack = [];
  function modal({ title, body, buttons = [], wide = false, onCancel }) {
    const backdrop = h('div', { class: 'backdrop' });
    const footer = h('footer');
    const ctl = {
      el: backdrop,
      close() {
        const i = modalStack.indexOf(ctl);
        if (i >= 0) modalStack.splice(i, 1);
        backdrop.remove();
        const t = tabs.get(activeId);
        if (t && !modalStack.length) (t.kind === 'editor' ? t.editor.focus() : t.term.focus());
      },
      cancel() { ctl.close(); if (onCancel) onCancel(); }
    };
    for (const b of buttons) {
      const btn = h('button', { class: 'btn ' + (b.kind || '') + (b.left ? ' left' : ''), type: 'button', onclick: async () => {
        const r = b.onClick ? await b.onClick(ctl) : undefined;
        if (r !== false && b.close !== false) ctl.close();
      } }, b.label);
      if (b.primary) btn.dataset.primary = '1';
      footer.append(btn);
    }
    backdrop.append(h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-label': title },
      h('header', {}, title), h('div', { class: 'body' }, body), footer));
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) ctl.cancel(); });
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); ctl.cancel(); }
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'search') {
        const p = footer.querySelector('[data-primary]'); if (p) { e.preventDefault(); p.click(); }
      }
    });
    $('#modalRoot').append(backdrop);
    modalStack.push(ctl);
    const first = backdrop.querySelector('input:not([type=checkbox]),select');
    if (first) setTimeout(() => first.focus(), 0);
    return ctl;
  }
  const toast = (title, message) => modal({ title, body: h('p', {}, message), buttons: [{ label: 'OK', kind: 'primary', primary: true }] });
  function promptSecret(title, hint, canRemember) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'password', style: 'width:100%', autocomplete: 'off' });
      const remember = h('input', { type: 'checkbox' });
      let answered = false;
      modal({
        title,
        body: h('div', {}, hint ? h('p', { class: 'err' }, hint) : null, input,
          canRemember ? h('label', { class: 'check', style: 'margin-top:10px' }, remember, 'Remember in this session (encrypted by your OS)') : null),
        buttons: [
          { label: 'Cancel', onClick: () => { answered = true; resolve(null); } },
          { label: 'Connect', kind: 'primary', primary: true, onClick: () => { answered = true; resolve({ value: input.value, remember: remember.checked }); } }
        ],
        onCancel: () => { if (!answered) resolve(null); }
      });
    });
  }

  function promptText(title, label, value = '') {
    return new Promise((resolve) => {
      const input = h('input', { type: 'text', value, style: 'width:100%', spellcheck: false });
      let done = false;
      modal({ title, body: h('div', {}, h('div', { class: 'hint', style: 'margin-bottom:6px' }, label), input),
        buttons: [{ label: 'Cancel', onClick: () => { done = true; resolve(null); } }, { label: 'OK', kind: 'primary', primary: true, onClick: () => { done = true; resolve(input.value); } }],
        onCancel: () => { if (!done) resolve(null); } });
    });
  }

  // ---------------------------------------------------------------- context menu
  const ctx = $('#ctxMenu');
  function showCtx(x, y, items) {
    ctx.replaceChildren(...items.map((it) => (it === '-' ? h('hr') : h('div', { onclick: () => { hideCtx(); it.action(); } }, h('span', {}, it.label), it.kb ? h('span', { class: 'kb' }, it.kb) : null))));
    ctx.hidden = false;
    const r = ctx.getBoundingClientRect();
    ctx.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
    ctx.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  }
  const hideCtx = () => { ctx.hidden = true; };
  addEventListener('mousedown', (e) => { if (!ctx.contains(e.target)) hideCtx(); }, true);
  addEventListener('blur', hideCtx);

  // ---------------------------------------------------------------- sessions sidebar
  async function loadSessions() { sessions = await api.sessions.list(); renderSessions(); }
  function renderSessions() {
    const q = $('#sessionFilter').value.trim().toLowerCase();
    const list = $('#sessionList');
    const shown = sessions.filter((s) => !q || `${s.name} ${s.host} ${s.username} ${s.group}`.toLowerCase().includes(q))
      .sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.name.localeCompare(b.name));
    list.replaceChildren();
    if (!shown.length) {
      list.append(h('div', { class: 'empty-list' }, sessions.length ? 'No sessions match your search.' : 'No saved sessions yet. Click ＋ to add one, or use Quick connect below.'));
      return;
    }
    let lastGroup = null;
    for (const s of shown) {
      const g = s.group || '';
      if (g !== lastGroup && (g || lastGroup !== null)) {
        lastGroup = g;
        const title = h('div', { class: 'group-title' + (collapsedGroups.has(g) ? ' collapsed' : ''), onclick: () => { collapsedGroups.has(g) ? collapsedGroups.delete(g) : collapsedGroups.add(g); renderSessions(); } }, g || 'Ungrouped');
        list.append(title);
      } else if (lastGroup === null) lastGroup = g;
      if (collapsedGroups.has(g)) continue;
      const icon = { password: '🔒', key: '🔑', agent: '🛡' }[s.auth] || '🔒';
      const row = h('div', { class: 'session', title: `${s.username}@${s.host}:${s.port}`,
        ondblclick: () => openTab(s),
        oncontextmenu: (e) => { e.preventDefault(); showCtx(e.clientX, e.clientY, [
          { label: 'Connect', action: () => openTab(s) }, { label: 'Connect in PiP window', action: () => openTab(s, { pip: true }) }, { label: 'Edit…', action: () => editSession(s) },
          { label: 'Duplicate', action: () => duplicateSession(s) }, '-', { label: 'Delete', action: () => deleteSession(s) }]); } },
        h('span', { class: 'ico' }, icon),
        h('div', { class: 'meta' }, h('div', { class: 'name' }, s.name), h('div', { class: 'sub' }, `${s.username}@${s.host}${s.port !== 22 ? ':' + s.port : ''}`)),
        h('button', { class: 'icon-btn edit', title: 'Edit', onclick: (e) => { e.stopPropagation(); editSession(s); } }, '✎'));
      list.append(row);
    }
  }
  async function deleteSession(s) {
    if (!confirm(`Delete saved session "${s.name}"?`)) return;
    await api.sessions.remove(s.id); await loadSessions();
  }
  async function duplicateSession(s) {
    const r = await api.sessions.save({ ...s, id: undefined, name: s.name + ' (copy)' });
    if (r.ok) await loadSessions();
  }

  // ---------------------------------------------------------------- session editor
  function editSession(existing, prefill) {
    const s = existing || { port: 22, auth: 'password', ...prefill };
    const f = {
      name: h('input', { type: 'text', value: s.name || '', placeholder: 'e.g. Production web server' }),
      group: h('input', { type: 'text', value: s.group || '', list: 'groupList', placeholder: 'optional' }),
      host: h('input', { type: 'text', value: s.host || '', placeholder: 'hostname or IP address', spellcheck: false }),
      port: h('input', { type: 'number', value: s.port || 22, min: 1, max: 65535, style: 'width:90px;flex:none' }),
      username: h('input', { type: 'text', value: s.username || '', spellcheck: false }),
      auth: h('select', {}, h('option', { value: 'password' }, 'Password'), h('option', { value: 'key' }, 'Private key file (PEM / OpenSSH / PPK)'), h('option', { value: 'agent' }, 'SSH agent (Pageant / ssh-agent)')),
      keyPath: h('input', { type: 'text', value: s.keyPath || '', placeholder: 'Path to .pem, .ppk or OpenSSH key', spellcheck: false }),
      password: h('input', { type: 'password', autocomplete: 'off', placeholder: s.hasPassword ? 'Saved — leave blank to keep' : 'Optional: save password' }),
      passphrase: h('input', { type: 'password', autocomplete: 'off', placeholder: s.hasPassphrase ? 'Saved — leave blank to keep' : 'Optional: save key passphrase' }),
      clearPw: h('input', { type: 'checkbox' }), clearPp: h('input', { type: 'checkbox' }),
      startup: h('input', { type: 'text', value: s.startupCommand || '', placeholder: 'Optional command to run after login', spellcheck: false })
    };
    f.auth.value = s.auth || 'password';
    const groups = [...new Set(sessions.map((x) => x.group).filter(Boolean))];
    const errBox = h('div', { class: 'err full' });
    const rows = {
      key: h('label', {}, 'Key file'), keyRow: h('div', { class: 'row' }, f.keyPath, h('button', { class: 'btn', type: 'button', onclick: async () => { const p = await api.pickKey(); if (p) f.keyPath.value = p; } }, 'Browse…')),
      pwLabel: h('label', {}, 'Saved password'), pwRow: h('div', {}, h('div', { class: 'row' }, f.password),
        s.hasPassword ? h('label', { class: 'check hint' }, f.clearPw, 'Remove saved password') : null),
      ppLabel: h('label', {}, 'Key passphrase'), ppRow: h('div', {}, h('div', { class: 'row' }, f.passphrase),
        s.hasPassphrase ? h('label', { class: 'check hint' }, f.clearPp, 'Remove saved passphrase') : null)
    };
    if (!info.secretsAvailable) { f.password.disabled = true; f.passphrase.disabled = true; }
    const refresh = () => {
      const a = f.auth.value;
      rows.key.hidden = rows.keyRow.hidden = a !== 'key';
      rows.ppLabel.hidden = rows.ppRow.hidden = a !== 'key';
      rows.pwLabel.hidden = rows.pwRow.hidden = a !== 'password';
    };
    f.auth.addEventListener('change', refresh); refresh();
    const body = h('div', { class: 'form-grid' },
      h('datalist', { id: 'groupList' }, groups.map((g) => h('option', { value: g }))),
      h('div', { class: 'section' }, 'Connection'),
      h('label', {}, 'Session name'), f.name, h('label', {}, 'Group / folder'), f.group,
      h('label', {}, 'Host'), h('div', { class: 'row' }, f.host, h('label', { style: 'margin:0 2px' }, 'Port'), f.port),
      h('label', {}, 'User name'), f.username,
      h('div', { class: 'section' }, 'Authentication'),
      h('label', {}, 'Method'), f.auth,
      rows.key, rows.keyRow, rows.pwLabel, rows.pwRow, rows.ppLabel, rows.ppRow,
      !info.secretsAvailable ? h('div', { class: 'hint full' }, 'Saving passwords is unavailable because no OS keyring was found, so you will be asked for them at connect time.') : null,
      h('div', { class: 'section' }, 'After login'),
      h('label', {}, 'Startup command'), f.startup, errBox);

    const collect = () => {
      const data = { id: s.id, name: f.name.value, group: f.group.value, host: f.host.value, port: f.port.value, username: f.username.value,
        auth: f.auth.value, keyPath: f.keyPath.value, startupCommand: f.startup.value };
      if (!data.host.trim()) { errBox.textContent = 'Host is required.'; return null; }
      if (!data.username.trim()) { errBox.textContent = 'User name is required.'; return null; }
      if (data.auth === 'key' && !data.keyPath.trim()) { errBox.textContent = 'Choose a key file.'; return null; }
      return data;
    };
    const persist = async () => {
      const data = collect(); if (!data) return null;
      const secrets = {};
      if (f.password.value) secrets.password = f.password.value;
      if (f.passphrase.value) secrets.passphrase = f.passphrase.value;
      if (f.clearPw.checked) secrets.clearPassword = true;
      if (f.clearPp.checked) secrets.clearPassphrase = true;
      const r = await api.sessions.save(data, secrets);
      if (!r.ok) { errBox.textContent = r.message || 'Could not save.'; return null; }
      await loadSessions();
      return r.session;
    };
    modal({
      title: existing ? 'Edit session' : 'New session', body, wide: true,
      buttons: [
        ...(existing ? [{ label: 'Delete', kind: 'danger', left: true, onClick: async () => { await deleteSession(existing); } }] : []),
        { label: 'Cancel' },
        { label: 'Save', onClick: async () => ((await persist()) ? true : false) },
        { label: 'Save & connect', kind: 'primary', primary: true, onClick: async (c) => { const saved = await persist(); if (!saved) return false; c.close(); openTab(saved); return false; } }
      ]
    });
  }

  // ---------------------------------------------------------------- terminals & tabs
  function copySelection(tab) {
    const text = tab.term.getSelection();
    if (text) api.clipboard.write(text);
    return !!text;
  }
  async function pasteInto(tab) {
    const text = await api.clipboard.read();
    if (text && tab.state === 'connected') tab.term.paste(text);
  }

  async function openTab(sess, opts = {}) {
    await ensureFont(settings.fontFamily, settings.fontSize);
    const id = uid();
    const pane = h('div', { class: 'pane hidden', dataset: { id } });
    const termWrap = h('div', { class: 'term-wrap' });
    pane.append(termWrap);
    $('#termHost').append(pane);
    const term = new Terminal(termOptions());
    const fit = new FitAddon.FitAddon();
    const search = new SearchAddon.SearchAddon();
    const serialize = new SerializeAddon.SerializeAddon();
    term.loadAddon(fit); term.loadAddon(search); term.loadAddon(serialize);
    term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => api.openExternal(uri)));
    term.open(termWrap);
    new ResizeObserver(() => { if (id === activeId) requestAnimationFrame(fitActive); }).observe(termWrap);
    const tab = { id, kind: 'ssh', serialize, popped: false, openInPip: !!opts.pip, sess: { ...sess }, term, fit, search, pane, state: 'connecting', title: sess.name || `${sess.username}@${sess.host}`, activity: false, fp: '' };
    tabs.set(id, tab);

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const ctrl = e.ctrlKey && !e.metaKey, alt = e.altKey;
      if (ctrl && !alt && e.code === 'KeyC' && (e.shiftKey || term.hasSelection())) { e.preventDefault(); if (copySelection(tab)) term.clearSelection(); return false; }
      if (ctrl && !alt && e.code === 'KeyV') { e.preventDefault(); pasteInto(tab); return false; }
      if (ctrl && !e.shiftKey && e.code === 'Insert') { e.preventDefault(); copySelection(tab); return false; }
      if (e.shiftKey && !ctrl && !alt && e.code === 'Insert') { e.preventDefault(); pasteInto(tab); return false; }
      return true;
    });
    term.onData((d) => {
      if (tab.state === 'connected') api.write(id, d);
      else if (tab.state === 'closed' && d === '\r') connectTab(tab);
    });
    term.onResize(({ cols, rows }) => { if (tab.state === 'connected') api.resize(id, cols, rows); updateStatus(); });
    term.onSelectionChange(() => { if (settings.copyOnSelect && term.hasSelection()) api.clipboard.write(term.getSelection()); });
    term.onTitleChange((t) => { tab.remoteTitle = t; if (id === activeId) document.title = `${t} — Iqbal Terminal`; });
    termWrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (settings.rightClick === 'paste') { if (term.hasSelection()) { copySelection(tab); term.clearSelection(); } else pasteInto(tab); return; }
      showCtx(e.clientX, e.clientY, [
        { label: 'Copy', kb: 'Ctrl+C', action: () => copySelection(tab) }, { label: 'Paste', kb: 'Ctrl+V', action: () => pasteInto(tab) },
        { label: 'Select all', action: () => term.selectAll() }, { label: 'Find…', kb: 'Ctrl+Shift+F', action: openFind }, '-',
        { label: 'Clear scrollback', action: () => term.clear() },
        ...(tab.state === 'closed' ? [{ label: 'Reconnect', kb: 'Enter', action: () => connectTab(tab) }] : []),
        { label: 'File manager', kb: 'Ctrl+Shift+D', action: () => toggleFiles(tab) }, { label: 'Pop out (PiP)', kb: 'Ctrl+Shift+P', action: () => popOut(tab) },
        { label: 'Duplicate tab', kb: 'Ctrl+Shift+T', action: () => openTab(tab.sess) }, { label: 'Close tab', kb: 'Ctrl+Shift+W', action: () => closeTab(id) }]);
    });
    termWrap.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setFontSize(settings.fontSize + (e.deltaY < 0 ? 1 : -1)); } }, { passive: false });
    termWrap.addEventListener('mousedown', () => term.focus());

    activateTab(id);
    connectTab(tab);
    return tab;
  }

  async function connectTab(tab, secrets = {}, remember = false) {
    const s = tab.sess;
    setState(tab, 'connecting');
    if (!Object.keys(secrets).length) tab.term.write(`\x1b[90mConnecting to ${s.username}@${s.host}:${s.port} …\x1b[0m\r\n`);
    const res = await api.connect({ id: tab.id, sessionId: s.id || null, params: s, secrets, remember, cols: tab.term.cols, rows: tab.term.rows });
    if (!tabs.has(tab.id)) return;
    if (res.ok) { tab.fp = res.fingerprint || ''; setState(tab, 'connected'); api.resize(tab.id, tab.term.cols, tab.term.rows); if (tab.sftp && !tab.sftp.el.hidden) tab.sftp.refresh(); if (tab.openInPip) { tab.openInPip = false; popOut(tab); } return; }
    if (res.needs) {
      const label = res.needs === 'password' ? `Password for ${s.username}@${s.host}` : `Passphrase for ${basename(s.keyPath)}`;
      const r = await promptSecret(label, res.message, !!s.id && info.secretsAvailable);
      if (!tabs.has(tab.id)) return;
      if (!r) { tab.term.write('\x1b[33m[Cancelled]\x1b[0m  Press Enter to try again\r\n'); setState(tab, 'closed'); return; }
      return connectTab(tab, { ...secrets, [res.needs]: r.value }, r.remember);
    }
    tab.term.write(`\x1b[31m[Failed] ${res.message || 'Could not connect'}\x1b[0m\r\nPress Enter to retry\r\n`);
    setState(tab, 'closed');
  }

  function setState(tab, state) { tab.state = state; renderTabs(); updateStatus(); }
  function renderTabs() {
    const bar = $('#tabs');
    bar.replaceChildren(...[...tabs.values()].map((t, i) => h('div', {
      class: 'tab' + (t.id === activeId ? ' active' : '') + (t.activity ? ' activity' : ''), role: 'tab', title: t.remoteTitle ? `${t.title} — ${t.remoteTitle}` : t.title,
      onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } else if (e.button === 0) activateTab(t.id); },
      oncontextmenu: (e) => { e.preventDefault(); showCtx(e.clientX, e.clientY, t.kind === 'editor'
        ? [{ label: 'Save', kb: 'Ctrl+S', action: () => t.editor.save() }, { label: 'Close tab', action: () => closeTab(t.id) }]
        : [{ label: 'File manager', kb: 'Ctrl+Shift+D', action: () => toggleFiles(t) }, { label: t.popped ? 'Dock back to tab' : 'Pop out (PiP)', kb: 'Ctrl+Shift+P', action: () => popOut(t) }, { label: 'Duplicate tab', action: () => openTab(t.sess) }, '-', { label: 'Close tab', action: () => closeTab(t.id) }]); }
    }, h('span', { class: 'dot ' + (t.kind === 'editor' ? 'editor' : t.popped ? 'popped' : t.state) }),
    h('span', { class: 'label' }, (t.popped ? 'PiP · ' : '') + t.title + (t.dirty ? ' •' : '')),
    h('span', { class: 'x', title: 'Close', onmousedown: (e) => e.stopPropagation(), onclick: () => closeTab(t.id) }, '×'))));
    $('#welcome').classList.toggle('hidden', tabs.size > 0);
  }
  function activateTab(id) {
    const t = tabs.get(id); if (!t) return;
    activeId = id; t.activity = false;
    for (const x of tabs.values()) x.pane.classList.toggle('hidden', x.id !== id);
    renderTabs();
    if (t.kind === 'ssh') lastSshId = id;
    requestAnimationFrame(() => { if (t.kind === 'editor') t.editor.focus(); else { fitActive(); if (!t.popped) t.term.focus(); } });
    document.title = (t.remoteTitle ? t.remoteTitle : t.title) + ' — Iqbal Terminal';
    updateStatus();
  }
  function closeTab(id) {
    const t = tabs.get(id); if (!t) return;
    if (t.kind === 'editor') { if (t.dirty && !confirm(`Discard unsaved changes to ${t.title}?`)) return; }
    else { if (t.state === 'connected' && !confirm(`Disconnect from ${t.title}?`)) return; api.disconnect(id); if (t.sftp) t.sftp.destroy(); t.term.dispose(); }
    t.pane.remove(); tabs.delete(id);
    if (activeId === id) {
      activeId = null;
      const rest = [...tabs.keys()];
      if (rest.length) activateTab(rest[Math.min(rest.length - 1, [...tabs.keys()].length - 1)]);
    }
    renderTabs(); updateStatus();
    if (!tabs.size) document.title = 'Iqbal Terminal';
  }
  function cycleTab(dir) {
    const ids = [...tabs.keys()]; if (ids.length < 2) return;
    activateTab(ids[(ids.indexOf(activeId) + dir + ids.length) % ids.length]);
  }
  function fitActive() {
    const t = tabs.get(activeId); if (!t || t.kind === 'editor') return;
    try { t.fit.fit(); } catch (_) { /* pane not measurable yet */ }
  }
  function updateStatus() {
    const t = tabs.get(activeId);
    if (t && t.kind === 'editor') { $('#statusLeft').textContent = `${t.title}${t.dirty ? ' (unsaved changes)' : ''}`; $('#statusRight').textContent = t.editor.stats(); return; }
    const connected = [...tabs.values()].filter((x) => x.kind === 'ssh' && x.state === 'connected').length;
    const stateText = { connecting: 'Connecting…', connected: 'Connected', closed: 'Disconnected' };
    $('#statusLeft').textContent = t ? `${t.sess.username}@${t.sess.host}:${t.sess.port} · ${stateText[t.state]}${t.fp ? ' · ' + t.fp.slice(0, 22) + '…' : ''}` : 'Ready';
    $('#statusRight').textContent = `${t ? t.term.cols + '×' + t.term.rows + ' · ' : ''}${settings.fontFamily} ${settings.fontSize}px · ${connected} active`;
  }

  // ---------------------------------------------------------------- remote file manager (SFTP)
  function toggleFiles(tab) {
    if (!tab || tab.kind !== 'ssh') return toast('File manager', 'Select an SSH session tab first.');
    if (tab.popped) return toast('File manager', 'Dock the session back into a tab to use the file manager.');
    if (!tab.sftp) {
      if (tab.state !== 'connected') return toast('File manager', 'Connect the session first.');
      tab.sftp = SftpPanel.create({ api, connId: tab.id, ui: { promptText, toast, showCtx }, onClose: () => toggleFiles(tab) });
      tab.pane.append(tab.sftp.el);
    }
    const show = tab.sftp.el.hidden;
    if (show && tab.state !== 'connected') return toast('File manager', 'Reconnect the session first.');
    tab.sftp.el.hidden = !show;
    if (show) tab.sftp.load(tab.sftp.loaded ? '' : '').then(() => {});
    requestAnimationFrame(() => { fitActive(); if (!show) tab.term.focus(); });
  }
  api.onSftpProgress((ev) => { const t = tabs.get(ev.id); if (t && t.sftp) t.sftp.onProgress(ev); });

  // ---------------------------------------------------------------- PiP (floating session windows)
  async function popOut(tab) {
    if (!tab || tab.kind !== 'ssh') return toast('Picture-in-picture', 'Select an SSH session tab first.');
    if (tab.popped) { api.pip.askDock(tab.id); return; }
    if (tab.state !== 'connected') return toast('Picture-in-picture', 'Connect the session first, then pop it out.');
    const r = await api.pip.open({ id: tab.id, title: tab.title, buffer: tab.serialize.serialize(), cols: tab.term.cols, rows: tab.term.rows });
    if (!r.ok) return toast('Picture-in-picture', r.message || 'Could not open the floating window.');
    tab.popped = true;
    if (tab.sftp) tab.sftp.el.hidden = true;
    tab.cover = h('div', { class: 'popped-cover' }, h('div', {}, `${tab.title} is floating in its own window.`),
      h('div', { style: 'display:flex;gap:8px' },
        h('button', { class: 'btn', onclick: () => api.pip.open({ id: tab.id, title: tab.title }) }, 'Show window'),
        h('button', { class: 'btn primary', onclick: () => api.pip.askDock(tab.id) }, 'Dock back')));
    tab.pane.append(tab.cover);
    renderTabs(); updateStatus();
  }
  api.onDocked(({ id, buffer, closed, reason }) => {
    const t = tabs.get(id); if (!t) return;
    t.popped = false; if (t.cover) { t.cover.remove(); t.cover = null; }
    if (buffer) { t.term.reset(); t.term.write(buffer); }
    if (closed) {
      t.term.write(`\r\n\x1b[31m[Disconnected${reason ? ': ' + reason : ''}]\x1b[0m  Press Enter to reconnect\r\n`);
      setState(t, 'closed');
    } else { renderTabs(); requestAnimationFrame(() => { fitActive(); api.resize(id, t.term.cols, t.term.rows); }); }
    if (activeId === id) t.term.focus();
  });

  // ---------------------------------------------------------------- text editor tabs
  function openEditor() {
    const id = uid();
    const pane = h('div', { class: 'pane editor-pane hidden' });
    $('#termHost').append(pane);
    const tab = { id, kind: 'editor', title: 'Untitled', dirty: false, pane };
    tab.editor = RichEditor.create({
      api, promptText, toast, onSend: (text) => sendToTerminal(text),
      onState: (st) => { tab.title = st.title; tab.dirty = st.dirty; renderTabs(); if (activeId === id) updateStatus(); }
    });
    pane.append(tab.editor.el);
    tabs.set(id, tab);
    activateTab(id);
  }
  function sendToTerminal(text) {
    const t = tabs.get(lastSshId);
    if (!text || !t) return toast('Send to terminal', !text ? 'There is no text to send.' : 'Open an SSH session first.');
    if (t.state !== 'connected') return toast('Send to terminal', `${t.title} is not connected.`);
    if (t.popped) return toast('Send to terminal', `${t.title} is in a PiP window. Dock it back first.`);
    const lines = text.split('\n').length;
    if (lines > 1 && !confirm(`Paste ${lines} lines into ${t.title}? They will run as if you typed them.`)) return;
    activateTab(t.id); t.term.paste(text);
  }

  // ---------------------------------------------------------------- incoming events
  api.onData((id, data) => {
    const t = tabs.get(id); if (!t) return;
    t.term.write(data);
    if (id !== activeId && !t.activity) { t.activity = true; renderTabs(); }
  });
  api.onClosed(({ id, reason }) => {
    const t = tabs.get(id); if (!t) return;
    t.term.write(`\r\n\x1b[31m[Disconnected${reason ? ': ' + reason : ''}]\x1b[0m  Press Enter to reconnect\r\n`);
    setState(t, 'closed');
  });
  api.onKbd(({ reqId, name, instructions, prompts }) => {
    const inputs = prompts.map((p) => h('input', { type: p.echo ? 'text' : 'password', style: 'width:100%', autocomplete: 'off' }));
    let done = false;
    modal({
      title: name || 'Server authentication',
      body: h('div', {}, instructions ? h('p', { class: 'hint' }, instructions) : null,
        prompts.map((p, i) => h('div', { style: 'margin:8px 0' }, h('div', { class: 'hint' }, p.prompt), inputs[i]))),
      buttons: [{ label: 'Cancel', onClick: () => { done = true; api.kbdReply(reqId, []); } },
        { label: 'Submit', kind: 'primary', primary: true, onClick: () => { done = true; api.kbdReply(reqId, inputs.map((i) => i.value)); } }],
      onCancel: () => { if (!done) api.kbdReply(reqId, []); }
    });
  });
  api.onNewSession(() => editSession(null));

  // ---------------------------------------------------------------- find bar
  function openFind() {
    const cur = tabs.get(activeId); if (!cur || cur.kind === 'editor') return;
    $('#findbar').hidden = false; $('#findInput').focus(); $('#findInput').select();
  }
  function closeFind() {
    $('#findbar').hidden = true;
    const t = tabs.get(activeId); if (t && t.search) { t.search.clearDecorations(); t.term.focus(); }
  }
  const doFind = (dir, incremental) => {
    const t = tabs.get(activeId); const q = $('#findInput').value; if (!t || t.kind === 'editor' || !q) return;
    const opts = { incremental, decorations: { matchOverviewRuler: '#d29922', activeMatchColorOverviewRuler: '#58a6ff' } };
    dir > 0 ? t.search.findNext(q, opts) : t.search.findPrevious(q, opts);
  };
  $('#findInput').addEventListener('input', () => doFind(1, true));
  $('#findInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doFind(e.shiftKey ? -1 : 1, false); } else if (e.key === 'Escape') closeFind(); });
  $('#findNext').onclick = () => doFind(1, false); $('#findPrev').onclick = () => doFind(-1, false); $('#findClose').onclick = closeFind;

  // ---------------------------------------------------------------- settings / about dialogs
  function openSettings() {
    const sel = (opts, value, onChange) => {
      const s = h('select', {}, opts.map(([v, l]) => h('option', { value: v }, l)));
      s.value = value; s.addEventListener('change', () => onChange(s.value)); return s;
    };
    const num = (value, min, max, step, onChange) => {
      const i = h('input', { type: 'number', value, min, max, step, style: 'width:110px' });
      i.addEventListener('change', () => { const v = parseFloat(i.value); if (!Number.isNaN(v)) onChange(clamp(v, min, max)); });
      return i;
    };
    const chk = (value, onChange) => { const c = h('input', { type: 'checkbox', checked: value }); c.addEventListener('change', () => onChange(c.checked)); return c; };

    const installed = SYSTEM_FONTS.filter(fontInstalled);
    const fontOptions = [...BUNDLED_FONTS, ...installed];
    const isCustom = !fontOptions.includes(settings.fontFamily);
    const fontSel = sel([...fontOptions.map((f) => [f, f]), ['__custom', 'Custom…']], isCustom ? '__custom' : settings.fontFamily, (v) => {
      custom.hidden = v !== '__custom';
      if (v !== '__custom') saveSettings({ fontFamily: v }); else custom.focus();
    });
    const custom = h('input', { type: 'text', value: isCustom ? settings.fontFamily : '', placeholder: 'Installed monospace font name', hidden: !isCustom, style: 'margin-top:6px' });
    custom.addEventListener('change', () => { if (custom.value.trim()) saveSettings({ fontFamily: custom.value.trim() }); });

    const body = h('div', { class: 'form-grid' },
      h('div', { class: 'section' }, 'Appearance'),
      h('label', {}, 'Application theme'), sel([['dark', 'Dark'], ['light', 'Light'], ['matrix', 'Black & green (Matrix)'], ['system', 'Follow system']], settings.uiTheme, (v) => saveSettings({ uiTheme: v })),
      h('label', {}, 'Terminal colors'), sel([['auto', 'Automatic (match theme)'], ...window.TERM_SCHEMES.map((s) => [s.name, `${s.name} (${s.kind})`])], settings.termScheme, (v) => saveSettings({ termScheme: v })),
      h('label', {}, 'Font'), h('div', {}, fontSel, custom),
      h('label', {}, 'Font size'), num(settings.fontSize, 8, 40, 1, (v) => saveSettings({ fontSize: v })),
      h('label', {}, 'Line height'), num(settings.lineHeight, 1, 1.8, 0.05, (v) => saveSettings({ lineHeight: v })),
      h('label', {}, 'Cursor'), h('div', { class: 'row' }, sel([['block', 'Block'], ['bar', 'Bar'], ['underline', 'Underline']], settings.cursorStyle, (v) => saveSettings({ cursorStyle: v })),
        h('label', { class: 'check' }, chk(settings.cursorBlink, (v) => saveSettings({ cursorBlink: v })), 'Blink')),
      h('div', { class: 'section' }, 'Terminal'),
      h('label', {}, 'Scrollback lines'), num(settings.scrollback, 1000, 200000, 1000, (v) => saveSettings({ scrollback: v })),
      h('label', {}, 'Right-click'), sel([['menu', 'Show context menu'], ['paste', 'Paste (PuTTY style)']], settings.rightClick, (v) => saveSettings({ rightClick: v })),
      h('label', {}, 'Copy on select'), h('label', { class: 'check' }, chk(settings.copyOnSelect, (v) => saveSettings({ copyOnSelect: v })), 'Copy selected text automatically'),
      h('div', { class: 'section' }, 'Background & connections'),
      h('label', {}, 'Close button'), h('div', {}, h('label', { class: 'check' }, chk(settings.closeToTray, (v) => saveSettings({ closeToTray: v })), 'Keep running in the system tray'),
        info.trayAvailable ? null : h('div', { class: 'hint' }, 'No system tray was detected on this desktop; the window will close normally.')),
      h('label', {}, 'Keep-alive (seconds)'), num(settings.keepAlive, 0, 600, 5, (v) => saveSettings({ keepAlive: v })),
      h('label', {}, 'Trusted host keys'), h('div', {}, h('button', { class: 'btn', onclick: async () => { if (confirm('Forget all trusted host keys?')) { await api.clearKnownHosts(); toast('Done', 'Trusted host keys cleared.'); } } }, 'Forget all host keys')),
      h('label', {}, 'Data folder'), h('div', {}, h('button', { class: 'btn', onclick: () => api.openDataDir() }, 'Open'), h('div', { class: 'hint' }, info.dataDir)));
    modal({ title: 'Settings', body, wide: true, buttons: [{ label: 'Close', kind: 'primary', primary: true }] });
  }
  function openAbout() {
    const row = (k, v) => [h('label', {}, k), h('div', {}, v)];
    modal({
      title: 'About Iqbal Terminal',
      body: h('div', { class: 'form-grid' },
        ...row('Version', info.version),
        ...row('Author', `${info.author} <${info.email}>`),
        ...row('License', `${info.license} — free to use, modify and share`),
        info.repo ? row('Source', String(info.repo).replace(/^git\+/, '')) : [],
        ...row('Built with', `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`),
        h('div', { class: 'hint full', style: 'margin-top:6px' }, 'Multi-session SSH terminal with an SFTP file manager, floating PiP windows, PEM / OpenSSH / PPK keys and a built-in rich text editor.'),
        h('div', { class: 'hint full' }, `Copyright © 2026 ${info.author}. Provided “as is”, without warranty.`)),
      buttons: [{ label: 'OK', kind: 'primary', primary: true }]
    });
  }
  function importExportMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    showCtx(r.left, r.bottom + 4, [
      { label: 'Import sessions…', action: async () => { const x = await api.sessions.import(); if (x.ok) { await loadSessions(); toast('Imported', `${x.count} session(s) imported. Passwords are never imported or exported.`); } else if (x.message) toast('Import failed', x.message); } },
      { label: 'Export sessions…', action: async () => { const x = await api.sessions.export(); if (x.ok) toast('Exported', `${x.count} session(s) exported without passwords.`); } }]);
  }

  // ---------------------------------------------------------------- quick connect
  function quickConnect(text) {
    const m = /^(?:([^@\s]+)@)?(\[[0-9a-f:]+\]|[^:\s@]+)(?::(\d{1,5}))?$/i.exec(text.trim());
    if (!m) return toast('Quick connect', 'Use the form user@host or user@host:port.');
    const host = m[2].replace(/^\[|\]$/g, '');
    if (!m[1]) return editSession(null, { host, port: m[3] ? +m[3] : 22 });
    openTab({ name: `${m[1]}@${host}`, host, port: m[3] ? +m[3] : 22, username: m[1], auth: 'password' });
  }

  // ---------------------------------------------------------------- shortcuts
  addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey && !e.metaKey;
    const consume = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (ctrl && e.shiftKey && e.code === 'KeyN') return consume(() => editSession(null));
    if (ctrl && e.shiftKey && e.code === 'KeyT') return consume(() => { const t = tabs.get(activeId); t ? openTab(t.sess) : editSession(null); });
    if (ctrl && e.shiftKey && e.code === 'KeyW') return consume(() => closeTab(activeId));
    if (ctrl && e.shiftKey && e.code === 'KeyF') return consume(openFind);
    if (ctrl && e.shiftKey && e.code === 'KeyP') return consume(() => popOut(tabs.get(activeId)));
    if (ctrl && e.shiftKey && e.code === 'KeyD') return consume(() => toggleFiles(tabs.get(activeId)));
    if (ctrl && e.shiftKey && e.code === 'KeyE') return consume(openEditor);
    if (ctrl && (e.code === 'PageDown' || (e.code === 'Tab' && !e.shiftKey))) return consume(() => cycleTab(1));
    if (ctrl && (e.code === 'PageUp' || (e.code === 'Tab' && e.shiftKey))) return consume(() => cycleTab(-1));
    if (e.altKey && !ctrl && /^Digit[1-9]$/.test(e.code)) return consume(() => { const ids = [...tabs.keys()]; const t = ids[+e.code.slice(5) - 1]; if (t) activateTab(t); });
    if (ctrl && !e.altKey && ['Equal', 'NumpadAdd'].includes(e.code)) return consume(() => zoomActive(1));
    if (ctrl && !e.altKey && ['Minus', 'NumpadSubtract'].includes(e.code)) return consume(() => zoomActive(-1));
    if (ctrl && !e.altKey && ['Digit0', 'Numpad0'].includes(e.code)) return consume(() => zoomActive(0));
    if (e.key === 'F11') return consume(() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()));
  }, true);

  // ---------------------------------------------------------------- wire up UI
  $('#btnNewSession').onclick = () => editSession(null);
  $('#btnNewTab').onclick = () => editSession(null);
  $('#welcomeNew').onclick = () => editSession(null);
  $('#welcomeSettings').onclick = openSettings;
  $('#btnSettings').onclick = openSettings;
  $('#btnAbout').onclick = openAbout;
  $('#btnImportExport').onclick = importExportMenu;
  $('#btnFontPlus').onclick = () => zoomActive(1);
  $('#btnFontMinus').onclick = () => zoomActive(-1);
  $('#btnPip').onclick = () => popOut(tabs.get(activeId));
  $('#btnFiles').onclick = () => toggleFiles(tabs.get(activeId));
  $('#btnEditor').onclick = openEditor;
  $('#welcomeEditor').onclick = openEditor;
  $('#btnTheme').onclick = () => saveSettings({ uiTheme: { dark: 'light', light: 'matrix', matrix: 'dark' }[effectiveUiTheme()] || 'dark' });
  $('#sessionFilter').addEventListener('input', renderSessions);
  $('#quickConnect').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) { quickConnect(e.target.value); e.target.value = ''; } });
  $('#btnSidebar').onclick = () => {
    const hidden = !$('#sidebar').classList.contains('hidden');
    $('#sidebar').classList.toggle('hidden', hidden); $('#splitter').classList.toggle('hidden', hidden);
    saveSettings({ sidebarOpen: !hidden });
  };
  (() => {
    const sp = $('#splitter'), sb = $('#sidebar');
    sp.addEventListener('mousedown', (e) => {
      e.preventDefault(); sp.classList.add('drag');
      const move = (ev) => { sb.style.width = clamp(ev.clientX, 180, 520) + 'px'; };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); sp.classList.remove('drag'); saveSettings({ sidebarWidth: parseInt(sb.style.width, 10) }); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    });
  })();
  new ResizeObserver(() => requestAnimationFrame(fitActive)).observe($('#termHost'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (settings.uiTheme === 'system') applySettings(); });

  // ---------------------------------------------------------------- start
  (async () => {
    [settings, info] = await Promise.all([api.settings.get(), api.info()]);
    $('#sidebar').style.width = settings.sidebarWidth + 'px';
    if (!settings.sidebarOpen) { $('#sidebar').classList.add('hidden'); $('#splitter').classList.add('hidden'); }
    await applySettings();
    await loadSessions();
    renderTabs(); updateStatus();
  })();
})();
