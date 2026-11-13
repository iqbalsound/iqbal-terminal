'use strict';
(async () => {
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const id = new URLSearchParams(location.search).get('id');
  const [settings, init] = await Promise.all([api.settings.get(), api.pip.init(id)]);
  if (!init) { document.body.textContent = 'This session is no longer available.'; return; }

  const dark = settings.uiTheme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : settings.uiTheme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const scheme = (settings.termScheme !== 'auto' && window.TERM_SCHEMES.find((x) => x.name === settings.termScheme)) ||
    window.TERM_SCHEMES.find((x) => x.name === (dark ? 'Iqbal Dark' : 'Iqbal Light'));
  document.documentElement.style.setProperty('--term-bg', scheme.colors.background);
  $('#pipTitle').textContent = init.title;
  document.title = `${init.title} (PiP)`;

  let fontSize = Math.max(10, settings.fontSize - 2);
  const stack = (n) => `"${n}", "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Liberation Mono", Menlo, monospace`;
  try { await Promise.all([document.fonts.load(`${fontSize}px "${settings.fontFamily}"`), document.fonts.load(`bold ${fontSize}px "${settings.fontFamily}"`)]); } catch (_) { /* ignore */ }

  const term = new Terminal({
    fontFamily: stack(settings.fontFamily), fontSize, lineHeight: settings.lineHeight, cursorBlink: settings.cursorBlink,
    cursorStyle: settings.cursorStyle, scrollback: settings.scrollback, theme: scheme.colors,
    cols: init.cols || 80, rows: init.rows || 24
  });
  const fit = new FitAddon.FitAddon(); const ser = new SerializeAddon.SerializeAddon();
  term.loadAddon(fit); term.loadAddon(ser);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => api.openExternal(uri)));
  term.open($('#pipTerm'));
  let closed = false;
  if (init.buffer) term.write(init.buffer);
  const handleClosed = (reason) => {
    if (closed) return; closed = true;
    $('#pipDot').classList.add('closed');
    term.write(`\r\n\x1b[31m[Disconnected${reason ? ': ' + reason : ''}]\x1b[0m\r\n`);
    setTimeout(() => dock({ closed: true, reason }), 1200);   // hand the dead session back to the main window
  };
  for (const [channel, args] of init.pending || []) {
    if (channel === 'ssh:data') term.write(args[1]); else if (channel === 'ssh:closed') handleClosed(args[0].reason);
  }
  const doFit = () => { try { fit.fit(); } catch (_) { /* not measurable yet */ } };
  doFit(); term.focus();

  function dock(extra) {
    api.pip.dock(id, { buffer: ser.serialize(), cols: term.cols, rows: term.rows, ...(extra || {}) });
  }
  api.onData((sid, data) => { if (sid === id) term.write(data); });
  api.onClosed(({ id: sid, reason }) => { if (sid === id) handleClosed(reason); });
  api.onRequestDock(() => dock());

  term.onData((d) => { if (!closed) api.write(id, d); });
  term.onResize(({ cols, rows }) => { if (!closed) api.resize(id, cols, rows); });
  new ResizeObserver(() => requestAnimationFrame(doFit)).observe($('#pipTerm'));

  // Same copy / paste behaviour as the main window.
  const copySel = () => { const t = term.getSelection(); if (t) api.clipboard.write(t); return !!t; };
  const paste = async () => { const t = await api.clipboard.read(); if (t && !closed) term.paste(t); };
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const ctrl = e.ctrlKey && !e.metaKey;
    if (ctrl && !e.altKey && e.code === 'KeyC' && (e.shiftKey || term.hasSelection())) { e.preventDefault(); if (copySel()) term.clearSelection(); return false; }
    if (ctrl && !e.altKey && e.code === 'KeyV') { e.preventDefault(); paste(); return false; }
    if (e.shiftKey && !ctrl && e.code === 'Insert') { e.preventDefault(); paste(); return false; }
    if (ctrl && !e.altKey && ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Digit0'].includes(e.code)) {
      e.preventDefault(); setSize(e.code.includes('Minus') || e.code === 'NumpadSubtract' ? fontSize - 1 : e.code === 'Digit0' ? 12 : fontSize + 1); return false;
    }
    return true;
  });
  $('#pipTerm').addEventListener('contextmenu', (e) => { e.preventDefault(); if (term.hasSelection()) { copySel(); term.clearSelection(); } else paste(); });
  $('#pipTerm').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setSize(fontSize + (e.deltaY < 0 ? 1 : -1)); } }, { passive: false });

  function setSize(n) { fontSize = Math.min(36, Math.max(7, Math.round(n))); term.options.fontSize = fontSize; doFit(); }
  $('#pipSmaller').onclick = () => setSize(fontSize - 1);
  $('#pipBigger').onclick = () => setSize(fontSize + 1);
  let onTop = true; $('#pipPin').onclick = (e) => { onTop = !onTop; api.pip.setOnTop(onTop); e.currentTarget.classList.toggle('on', onTop); };
  const steps = [1, 0.85, 0.7, 0.55]; let si = 0;
  $('#pipOpacity').onclick = (e) => { si = (si + 1) % steps.length; api.pip.setOpacity(steps[si]); e.currentTarget.textContent = Math.round(steps[si] * 100) + '%'; };
  $('#pipDock').onclick = () => dock();
})();
