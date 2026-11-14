'use strict';
// File manager panel (SFTP) shown beside a terminal. All transfers run in the main process.
window.SftpPanel = (() => {
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in e && k !== 'list') e[k] = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  };
  const fmtSize = (n) => {
    if (n < 1024) return `${n} B`;
    const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return `${n >= 100 ? n.toFixed(0) : n.toFixed(1)} ${u[i]}`;
  };
  const fmtDate = (s) => (s ? new Date(s * 1000).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const join = (dir, name) => (dir === '/' ? '' : dir.replace(/\/+$/, '')) + '/' + name;
  const parent = (p) => p.replace(/\/[^/]*\/?$/, '') || '/';

  function create({ api, connId, ui, onClose }) {
    let cwd = '', entries = [], sel = new Set(), anchor = null, hidden = true, loading = false;
    let sort = { key: 'name', dir: 1 };
    const jobs = new Map();

    const pathInput = h('input', { type: 'text', class: 'sf-path', spellcheck: false, title: 'Remote folder (press Enter to go)',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); load(pathInput.value.trim() || '/'); } } });
    const msg = h('div', { class: 'sf-msg' });
    const list = h('div', { class: 'sf-list', tabIndex: 0 });
    const jobsBox = h('div', { class: 'sf-jobs' });
    const btn = (label, title, fn) => h('button', { class: 'sf-btn', type: 'button', title, onclick: fn }, label);
    const hiddenChk = h('input', { type: 'checkbox', checked: true, onchange: () => { hidden = hiddenChk.checked; render(); } });

    const el = h('div', { class: 'sftp', hidden: true },
      h('div', { class: 'sf-head' }, h('span', { class: 'sf-title' }, 'Files (SFTP)'), btn('×', 'Close panel', () => onClose())),
      h('div', { class: 'sf-nav' }, btn('↑', 'Parent folder (Backspace)', () => up()), btn('⟳', 'Refresh (F5)', () => refresh()), pathInput),
      h('div', { class: 'sf-actions' },
        btn('Upload files', 'Upload one or more files to this folder', () => upload('files')),
        btn('Upload folder', 'Upload a whole folder to this folder', () => upload('folder')),
        btn('Download', 'Download the selected files or folders', () => download()),
        btn('New folder', 'Create a folder here', () => newFolder()),
        btn('Rename', 'Rename the selected item (F2)', () => rename()),
        btn('Delete', 'Delete the selected items (Delete)', () => remove())),
      h('div', { class: 'sf-cols' },
        h('span', { class: 'c-name', onclick: () => setSort('name') }, 'Name'), h('span', { class: 'c-size', onclick: () => setSort('size') }, 'Size'),
        h('span', { class: 'c-date', onclick: () => setSort('mtime') }, 'Modified')),
      list, msg, jobsBox,
      h('label', { class: 'sf-foot' }, hiddenChk, 'Show hidden files'),
      h('div', { class: 'sf-drop' }, 'Drop files or folders here to upload'));

    function setSort(key) { sort = { key, dir: sort.key === key ? -sort.dir : 1 }; render(); }
    const visible = () => {
      const l = entries.filter((e) => hidden || !e.name.startsWith('.'));
      const dirFirst = (a, b) => (a.type === 'dir') === (b.type === 'dir') ? 0 : a.type === 'dir' ? -1 : 1;
      return l.sort((a, b) => dirFirst(a, b) || sort.dir * (sort.key === 'name' ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) : (a[sort.key] - b[sort.key])));
    };
    function setMsg(text, bad) { msg.textContent = text || ''; msg.classList.toggle('bad', !!bad); }

    function render() {
      const rows = visible();
      list.replaceChildren(...rows.map((e) => {
        const isDir = e.type === 'dir';
        const row = h('div', { class: 'sf-row' + (isDir ? ' dir' : '') + (sel.has(e.name) ? ' sel' : ''), dataset: { name: e.name },
          onclick: (ev) => select(e.name, ev), ondblclick: () => (isDir ? load(join(cwd, e.name)) : download([e])),
          oncontextmenu: (ev) => { ev.preventDefault(); if (!sel.has(e.name)) { sel = new Set([e.name]); anchor = e.name; render(); } menu(ev, e); } },
        h('span', { class: 'c-name', title: e.name + (e.link ? ' (link)' : '') }, h('span', { class: 'ic' }, isDir ? '📁' : e.type === 'file' ? '📄' : '🔗'), e.name),
        h('span', { class: 'c-size' }, isDir || e.type !== 'file' ? '' : fmtSize(e.size)), h('span', { class: 'c-date' }, fmtDate(e.mtime)));
        return row;
      }));
      if (!rows.length && !loading) list.append(h('div', { class: 'sf-empty' }, 'This folder is empty.'));
      setMsg(`${rows.length} item${rows.length === 1 ? '' : 's'}${sel.size ? ` · ${sel.size} selected` : ''}`);
    }
    function select(name, ev) {
      const names = visible().map((x) => x.name);
      if (ev.shiftKey && anchor && names.includes(anchor)) {
        const a = names.indexOf(anchor), b = names.indexOf(name);
        sel = new Set(names.slice(Math.min(a, b), Math.max(a, b) + 1));
      } else if (ev.ctrlKey || ev.metaKey) { sel.has(name) ? sel.delete(name) : sel.add(name); anchor = name; }
      else { sel = new Set([name]); anchor = name; }
      render();
    }
    const selected = () => entries.filter((e) => sel.has(e.name));

    async function load(path) {
      loading = true; setMsg('Loading…');
      const r = await api.sftp.list({ id: connId, path });
      loading = false;
      if (!r.ok) { setMsg(r.message || 'Could not list this folder.', true); return false; }
      cwd = r.path; pathInput.value = cwd; entries = r.entries; sel = new Set(); anchor = null; render();
      return true;
    }
    const refresh = () => load(cwd || '');
    const up = () => { if (cwd && cwd !== '/') load(parent(cwd)); };

    async function download(items) {
      const picked = items || selected();
      if (!picked.length) return ui.toast('Download', 'Select a file or folder first.');
      const r = await api.sftp.download({ id: connId, remoteDir: cwd, items: picked.map((e) => ({ name: e.name })) });
      if (!r.ok && !r.canceled) ui.toast('Download', r.message || 'Could not start the download.');
    }
    async function upload(mode, paths, dir) {
      const r = await api.sftp.upload({ id: connId, remoteDir: dir || cwd, mode, paths });
      if (!r.ok && !r.canceled) ui.toast('Upload', r.message || 'Could not start the upload.');
    }
    async function newFolder() {
      const name = await ui.promptText('New folder', `Create in ${cwd}`, '');
      if (!name || !name.trim()) return;
      const r = await api.sftp.mkdir({ id: connId, dir: cwd, name: name.trim() });
      if (!r.ok) return ui.toast('New folder', r.message || 'Could not create the folder.');
      refresh();
    }
    async function rename() {
      const [one] = selected(); if (!one || sel.size !== 1) return ui.toast('Rename', 'Select exactly one item.');
      const to = await ui.promptText('Rename', `New name for ${one.name}`, one.name);
      if (!to || !to.trim() || to === one.name) return;
      const r = await api.sftp.rename({ id: connId, dir: cwd, from: one.name, to: to.trim() });
      if (!r.ok) return ui.toast('Rename', r.message || 'Could not rename.');
      refresh();
    }
    async function remove() {
      const picked = selected(); if (!picked.length) return ui.toast('Delete', 'Select something to delete first.');
      const what = picked.length === 1 ? `“${picked[0].name}”` : `${picked.length} items`;
      const hasDir = picked.some((p) => p.type === 'dir');
      if (!confirm(`Permanently delete ${what} from the server${hasDir ? ' (folders are deleted with everything inside)' : ''}? This cannot be undone.`)) return;
      const r = await api.sftp.remove({ id: connId, dir: cwd, items: picked.map((e) => ({ name: e.name })) });
      if (!r.ok) ui.toast('Delete', r.message || 'Could not delete everything.');
      refresh();
    }
    function menu(ev, e) {
      ui.showCtx(ev.clientX, ev.clientY, [
        ...(e.type === 'dir' ? [{ label: 'Open', action: () => load(join(cwd, e.name)) }] : []),
        { label: 'Download', action: () => download() }, { label: 'Rename…', kb: 'F2', action: rename }, { label: 'Delete…', kb: 'Del', action: remove }, '-',
        { label: 'Copy path', action: () => api.clipboard.write(join(cwd, e.name)) }, { label: 'New folder…', action: newFolder },
        { label: 'Upload files…', action: () => upload('files') }, { label: 'Upload folder…', action: () => upload('folder') }, { label: 'Refresh', kb: 'F5', action: refresh }]);
    }
    list.addEventListener('contextmenu', (ev) => {
      if (ev.target !== list) return; ev.preventDefault();
      ui.showCtx(ev.clientX, ev.clientY, [{ label: 'New folder…', action: newFolder }, { label: 'Upload files…', action: () => upload('files') },
        { label: 'Upload folder…', action: () => upload('folder') }, { label: 'Refresh', kb: 'F5', action: refresh }]);
    });
    list.addEventListener('keydown', (e) => {
      if (e.key === 'Delete') { e.preventDefault(); remove(); }
      else if (e.key === 'F2') { e.preventDefault(); rename(); }
      else if (e.key === 'F5') { e.preventDefault(); refresh(); }
      else if (e.key === 'Backspace') { e.preventDefault(); up(); }
      else if (e.key === 'Enter') { const [one] = selected(); if (one && sel.size === 1) (one.type === 'dir' ? load(join(cwd, one.name)) : download([one])); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); sel = new Set(visible().map((x) => x.name)); render(); }
    });

    // ---- drag and drop from the desktop
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    el.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); dragDepth++; el.classList.add('dropping'); } });
    el.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    el.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; el.classList.remove('dropping'); } });
    el.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); dragDepth = 0; el.classList.remove('dropping');
      const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
      const row = e.target.closest && e.target.closest('.sf-row.dir');
      if (paths.length) upload('paths', paths, row ? join(cwd, row.dataset.name) : cwd);
    });

    // ---- transfer progress
    function onProgress(ev) {
      let j = jobs.get(ev.jobId);
      if (!j) {
        const bar = h('div', { class: 'bar' }, h('i'));
        const text = h('div', { class: 'jt' });
        const stop = h('button', { class: 'sf-btn', type: 'button', title: 'Cancel', onclick: () => (j.finished ? (j.card.remove(), jobs.delete(ev.jobId)) : api.sftp.cancel(ev.jobId)) }, '×');
        const card = h('div', { class: 'job' }, h('div', { class: 'jh' }, h('span', { class: 'jl' }), stop), bar, text);
        j = { card, bar: bar.firstChild, text, stop, title: card.querySelector('.jl'), start: Date.now(), finished: false };
        jobs.set(ev.jobId, j); jobsBox.prepend(card);
      }
      j.title.textContent = `${ev.kind === 'upload' ? 'Uploading' : 'Downloading'} ${ev.label}`;
      const pct = ev.total ? Math.min(100, Math.round((ev.bytes / ev.total) * 100)) : ev.state === 'done' ? 100 : 0;
      j.bar.style.width = pct + '%';
      const secs = Math.max(0.5, (Date.now() - j.start) / 1000);
      const states = { scanning: 'Preparing…', running: `${ev.files}/${ev.filesTotal} files · ${fmtSize(ev.bytes)} of ${fmtSize(ev.total)} · ${fmtSize(ev.bytes / secs)}/s`,
        done: `Done · ${ev.filesTotal} file${ev.filesTotal === 1 ? '' : 's'}, ${fmtSize(ev.total)}${ev.skipped ? ` · ${ev.skipped} link/special item(s) skipped` : ''}`,
        cancelled: 'Cancelled', error: ev.error || 'Failed' };
      j.text.textContent = states[ev.state] || ev.state;
      j.card.classList.toggle('err', ev.state === 'error'); j.card.classList.toggle('ok', ev.state === 'done');
      if (['done', 'cancelled', 'error'].includes(ev.state)) {
        j.finished = true; j.stop.textContent = '×'; j.stop.title = 'Dismiss';
        if (ev.kind === 'upload' && el.isConnected) refresh();
        if (ev.state === 'done') setTimeout(() => { if (jobs.get(ev.jobId) === j) { j.card.remove(); jobs.delete(ev.jobId); } }, 15000);
      }
    }

    return { el, load, refresh, onProgress, get loaded() { return !!cwd; }, destroy() { for (const id of jobs.keys()) api.sftp.cancel(id); el.remove(); } };
  }
  return { create };
})();
