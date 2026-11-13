'use strict';
// Clean rich-text editor: WYSIWYG editing, Markdown / plain text / HTML import and export.
window.RichEditor = (() => {
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in e) e[k] = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  };
  const SAFE = {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'strike', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
      'blockquote', 'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span'],
    ALLOWED_ATTR: ['href', 'colspan', 'rowspan'], ALLOW_DATA_ATTR: false
  };
  const clean = (html) => DOMPurify.sanitize(html, SAFE);
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**', hr: '---' });
  td.addRule('strike', { filter: ['s', 'del', 'strike'], replacement: (c) => `~~${c}~~` });
  td.addRule('underline', { filter: ['u'], replacement: (c) => `<u>${c}</u>` });
  td.addRule('preBlock', { filter: 'pre', replacement: (_c, node) => `\n\n\`\`\`\n${node.textContent.replace(/\n$/, '')}\n\`\`\`\n\n` });

  function create({ api, promptText, onState, onSend, toast }) {
    let dirty = false, fileName = '', zoom = 16, lastKind = 'md';
    const content = h('div', { class: 'ed-content', contentEditable: 'true', spellcheck: 'true', 'data-placeholder': 'Start typing…  Use the toolbar or Markdown shortcuts (Ctrl+B, Ctrl+I, Ctrl+U).' });
    content.innerHTML = '<p><br></p>';
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) { /* ignore */ }

    const cmd = (name, value) => { content.focus(); document.execCommand(name, false, value); changed(); sync(); };
    const block = (tag) => cmd('formatBlock', tag);
    const inlineCode = () => {
      content.focus();
      const sel = getSelection(); if (!sel.rangeCount) return;
      let n = sel.anchorNode; while (n && n !== content && !(n.nodeType === 1 && n.tagName === 'CODE')) n = n.parentNode;
      if (n && n.tagName === 'CODE') { n.replaceWith(document.createTextNode(n.textContent)); }
      else if (!sel.isCollapsed) document.execCommand('insertHTML', false, `<code>${esc(sel.toString())}</code>`);
      changed();
    };
    const link = async () => {
      content.focus();
      const sel = getSelection(); const saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      const url = await promptText('Insert link', 'Address (https://…)', 'https://');
      if (!url || !/^(https?:\/\/|mailto:)/i.test(url.trim())) { if (url) toast('Link', 'Only http, https and mailto links are allowed.'); return; }
      content.focus(); if (saved) { sel.removeAllRanges(); sel.addRange(saved); }
      if (sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(url.trim())}">${esc(url.trim())}</a>`);
      else document.execCommand('createLink', false, url.trim());
      changed();
    };

    // ---- toolbar
    const btns = {};
    const mk = (key, label, title, fn, extra) => {
      const b = h('button', { class: 'ed-btn' + (extra ? ' ' + extra : ''), type: 'button', title, onmousedown: (e) => e.preventDefault(), onclick: fn }, label);
      btns[key] = b; return b;
    };
    const sep = () => h('span', { class: 'ed-sep' });
    const heading = h('select', { class: 'ed-select', title: 'Paragraph style', onchange: () => { block(heading.value); } },
      h('option', { value: 'p' }, 'Paragraph'), h('option', { value: 'h1' }, 'Heading 1'), h('option', { value: 'h2' }, 'Heading 2'), h('option', { value: 'h3' }, 'Heading 3'),
      h('option', { value: 'blockquote' }, 'Quote'), h('option', { value: 'pre' }, 'Code block'));
    const saveMenu = h('select', { class: 'ed-select', title: 'Save as…', onchange: () => { const k = saveMenu.value; saveMenu.value = ''; if (k) save(k); } },
      h('option', { value: '' }, 'Save as…'), h('option', { value: 'md' }, 'Markdown (.md)'), h('option', { value: 'txt' }, 'Plain text (.txt)'), h('option', { value: 'html' }, 'HTML (.html)'));
    const toolbar = h('div', { class: 'ed-toolbar' },
      mk('new', 'New', 'New document (clears the editor)', () => reset(true)),
      mk('open', 'Open', 'Open a Markdown, text or HTML file (Ctrl+O)', () => open()),
      mk('save', 'Save', 'Save (Ctrl+S)', () => save(lastKind)), saveMenu, sep(),
      mk('undo', '↶', 'Undo (Ctrl+Z)', () => cmd('undo')), mk('redo', '↷', 'Redo (Ctrl+Y)', () => cmd('redo')), sep(), heading, sep(),
      mk('bold', 'B', 'Bold (Ctrl+B)', () => cmd('bold'), 'b'), mk('italic', 'I', 'Italic (Ctrl+I)', () => cmd('italic'), 'i'),
      mk('underline', 'U', 'Underline (Ctrl+U)', () => cmd('underline'), 'u'), mk('strike', 'S', 'Strikethrough', () => cmd('strikeThrough'), 's'),
      mk('code', '</>', 'Inline code', inlineCode), sep(),
      mk('ul', '• List', 'Bulleted list', () => cmd('insertUnorderedList')), mk('ol', '1. List', 'Numbered list', () => cmd('insertOrderedList')),
      mk('quote', '❝', 'Quote', () => block('blockquote')), mk('link', 'Link', 'Insert link (Ctrl+K)', link), mk('hr', '―', 'Horizontal line', () => cmd('insertHorizontalRule')),
      mk('clear', 'Clear', 'Clear formatting', () => { cmd('removeFormat'); block('p'); }), h('span', { class: 'ed-grow' }),
      mk('send', 'Send ▸ terminal', 'Paste the selection (or whole document) into the last SSH session', () => onSend(selectedText() || plain()), 'send'));

    // ---- selection state in toolbar
    function sync() {
      for (const [k, c] of [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['strike', 'strikeThrough'], ['ul', 'insertUnorderedList'], ['ol', 'insertOrderedList']]) {
        let on = false; try { on = document.queryCommandState(c); } catch (_) { /* ignore */ }
        btns[k].classList.toggle('on', on && document.activeElement === content);
      }
      if (document.activeElement === content) {
        let v = ''; try { v = document.queryCommandValue('formatBlock').toLowerCase().replace(/[<>]/g, ''); } catch (_) { /* ignore */ }
        heading.value = ['h1', 'h2', 'h3', 'blockquote', 'pre'].includes(v) ? v : 'p';
      }
    }
    document.addEventListener('selectionchange', () => { if (root.isConnected && document.activeElement === content) sync(); });

    const status = h('div', { class: 'ed-status' });
    const scroll = h('div', { class: 'ed-scroll' }, content);
    const root = h('div', { class: 'editor' }, toolbar, scroll);
    const setZoom = (z) => { zoom = Math.min(30, Math.max(11, z)); content.style.fontSize = zoom + 'px'; };
    setZoom(16);

    function selectedText() { const s = getSelection(); return s && !s.isCollapsed && content.contains(s.anchorNode) ? s.toString() : ''; }
    const plain = () => content.innerText.replace(/\n{3,}/g, '\n\n').trim();
    const markdown = () => td.turndown(clean(content.innerHTML)).replace(/^(\s*[-*+]) {3}/gm, '$1 ').replace(/^(\s*\d+\.) {2}/gm, '$1 ').trim() + '\n';
    const htmlDoc = () => `<!doctype html>\n<html><head><meta charset="utf-8"><title>${esc(fileName || 'Document')}</title>\n<style>body{font:16px/1.65 system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem}pre,code{font-family:ui-monospace,Consolas,monospace;background:#f2f4f6}pre{padding:.8rem;overflow:auto}code{padding:.1rem .3rem}blockquote{margin:1em 0;padding-left:1em;border-left:4px solid #c8d0d8;color:#555}</style></head>\n<body>\n${clean(content.innerHTML)}\n</body></html>\n`;
    const stats = () => {
      const t = plain(); const words = t ? t.split(/\s+/).length : 0;
      return `${words} word${words === 1 ? '' : 's'} · ${t.length} characters`;
    };
    function changed() { if (!dirty) { dirty = true; } emit(); }
    function emit() { onState({ title: fileName || 'Untitled', dirty, stats: stats() }); }
    content.addEventListener('input', () => { if (!content.innerHTML || content.innerHTML === '<br>') content.innerHTML = '<p><br></p>'; changed(); });

    // ---- paste: keep structure, drop foreign styling
    content.addEventListener('paste', (e) => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html'); const text = e.clipboardData.getData('text/plain');
      if (html) document.execCommand('insertHTML', false, clean(html)); else document.execCommand('insertText', false, text);
    });
    content.addEventListener('drop', (e) => e.preventDefault());

    // ---- keyboard
    content.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
      if (ctrl && e.code === 'KeyS') { e.preventDefault(); save(e.shiftKey ? 'md' : lastKind); }
      else if (ctrl && e.code === 'KeyO') { e.preventDefault(); open(); }
      else if (ctrl && e.code === 'KeyK') { e.preventDefault(); link(); }
      else if (e.key === 'Tab' && !e.shiftKey) {                       // Tab inserts spaces inside code blocks
        const sel = getSelection(); let n = sel.anchorNode;
        while (n && n !== content && !(n.nodeType === 1 && n.tagName === 'PRE')) n = n.parentNode;
        if (n && n.tagName === 'PRE') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
      }
    });
    // Markdown shortcuts at the start of a line: "# ", "## ", "- ", "1. ", "> "
    content.addEventListener('keyup', (e) => {
      if (e.key !== ' ') return;
      const sel = getSelection(); if (!sel.rangeCount || sel.anchorNode.nodeType !== 3) return;
      const node = sel.anchorNode; const m = /^(#{1,3}|-|\*|1\.|>)\u00a0?\s?$/.exec(node.textContent.slice(0, sel.anchorOffset).replace(/\u00a0/g, ' '));
      if (!m || node.textContent.length !== sel.anchorOffset) return;
      const p = node.parentNode; if (p !== content && p.parentNode !== content) return;
      node.textContent = '';
      ({ '#': () => block('h1'), '##': () => block('h2'), '###': () => block('h3'), '-': () => cmd('insertUnorderedList'), '*': () => cmd('insertUnorderedList'), '1.': () => cmd('insertOrderedList'), '>': () => block('blockquote') })[m[1]]();
    });
    content.addEventListener('contextmenu', () => { /* default spell-check menu is suppressed in Electron; keep native selection behaviour */ });

    // ---- file operations
    function reset(confirmFirst) {
      if (confirmFirst && dirty && !confirm('Discard unsaved changes?')) return;
      content.innerHTML = '<p><br></p>'; fileName = ''; dirty = false; lastKind = 'md'; emit(); content.focus();
    }
    function load({ name, ext, content: text }) {
      let html;
      if (ext === 'html' || ext === 'htm') html = clean((/<body[^>]*>([\s\S]*)<\/body>/i.exec(text) || [null, text])[1]);
      else if (ext === 'md' || ext === 'markdown') html = clean(marked.parse(text, { gfm: true }));
      else if (ext === 'txt' || ext === '') html = text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
      else html = `<pre>${esc(text)}</pre>`;                              // logs, configs, scripts keep their layout
      content.innerHTML = html || '<p><br></p>';
      fileName = name; lastKind = ['html', 'htm'].includes(ext) ? 'html' : ext === 'txt' ? 'txt' : 'md';
      dirty = false; emit();
    }
    async function open() {
      if (dirty && !confirm('Discard unsaved changes and open another file?')) return;
      const r = await api.file.open();
      if (r.ok) load(r); else if (r.message) toast('Open failed', r.message);
    }
    async function save(kind) {
      lastKind = kind;
      const body = kind === 'html' ? htmlDoc() : kind === 'txt' ? plain() + '\n' : markdown();
      const base = (fileName || 'document').replace(/\.[^.]+$/, '');
      const r = await api.file.save({ kind, defaultName: `${base}.${kind}`, content: body });
      if (r.ok) { fileName = r.name; dirty = false; emit(); } else if (r.message) toast('Save failed', r.message);
    }
    emit();
    return {
      el: root, focus: () => content.focus(), load, stats, markdown, plain, html: htmlDoc, isDirty: () => dirty,
      zoom: (d) => setZoom(d === 0 ? 16 : zoom + d), save: () => save(lastKind), open, status
    };
  }
  return { create };
})();
