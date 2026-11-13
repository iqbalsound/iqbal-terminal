// Copies browser-side libraries and fonts from node_modules into renderer/vendor
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'renderer', 'vendor');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

const copy = (from, to) => {
  const src = path.join(root, 'node_modules', from);
  if (!fs.existsSync(src)) { console.warn('missing', from); return; }
  fs.copyFileSync(src, path.join(out, to));
};
copy('@xterm/xterm/css/xterm.css', 'xterm.css');
copy('@xterm/xterm/lib/xterm.js', 'xterm.js');
copy('@xterm/addon-fit/lib/addon-fit.js', 'addon-fit.js');
copy('@xterm/addon-search/lib/addon-search.js', 'addon-search.js');
copy('@xterm/addon-web-links/lib/addon-web-links.js', 'addon-web-links.js');
copy('@xterm/addon-serialize/lib/addon-serialize.js', 'addon-serialize.js');
copy('marked/lib/marked.umd.js', 'marked.js');
copy('turndown/lib/turndown.browser.umd.js', 'turndown.js');
copy('dompurify/dist/purify.min.js', 'purify.js');

const fonts = {
  'jetbrains-mono': 'JetBrains Mono',
  'fira-code': 'Fira Code',
  'source-code-pro': 'Source Code Pro',
  'ibm-plex-mono': 'IBM Plex Mono',
  'inconsolata': 'Inconsolata'
};
let css = '';
for (const [pkg, family] of Object.entries(fonts)) {
  const dir = path.join(root, 'node_modules', '@fontsource', pkg, 'files');
  if (!fs.existsSync(dir)) { console.warn('missing font', pkg); continue; }
  for (const weight of [400, 700]) {
    const file = `${pkg}-latin-${weight}-normal.woff2`;
    if (!fs.existsSync(path.join(dir, file))) continue;
    fs.copyFileSync(path.join(dir, file), path.join(out, 'fonts', file));
    css += `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url('fonts/${file}') format('woff2');}\n`;
  }
}
fs.writeFileSync(path.join(out, 'fonts.css'), css);
console.log('vendor files ready');
