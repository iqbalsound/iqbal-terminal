'use strict';
// Terminal colour schemes. ansi = 16 colours: black,red,green,yellow,blue,magenta,cyan,white then the bright set.
const mk = (name, kind, bg, fg, cursor, sel, ansi) => ({
  name, kind,
  colors: {
    background: bg, foreground: fg, cursor, cursorAccent: bg, selectionBackground: sel,
    black: ansi[0], red: ansi[1], green: ansi[2], yellow: ansi[3], blue: ansi[4], magenta: ansi[5], cyan: ansi[6], white: ansi[7],
    brightBlack: ansi[8], brightRed: ansi[9], brightGreen: ansi[10], brightYellow: ansi[11], brightBlue: ansi[12], brightMagenta: ansi[13], brightCyan: ansi[14], brightWhite: ansi[15]
  }
});
window.TERM_SCHEMES = [
  mk('Matrix Green', 'dark', '#000000', '#00ff41', '#00ff41', '#0a3d12',
    ['#000000', '#ff5555', '#00ff41', '#c8ff00', '#3a9bff', '#d65cff', '#00ffd0', '#b6ffb6', '#2d6a35', '#ff7b7b', '#66ff8c', '#e6ff66', '#7cbcff', '#e592ff', '#66ffe0', '#eaffea']),
  mk('Iqbal Dark', 'dark', '#0d1117', '#e6edf3', '#58a6ff', '#264f78',
    ['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4', '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc']),
  mk('Iqbal Light', 'light', '#ffffff', '#1f2328', '#0969da', '#b6d6fd',
    ['#24292f', '#cf222e', '#116329', '#9a6700', '#0969da', '#8250df', '#1b7c83', '#6e7781', '#57606a', '#a40e26', '#1a7f37', '#7d4e00', '#218bff', '#a475f9', '#3192aa', '#8c959f']),
  mk('Solarized Dark', 'dark', '#002b36', '#839496', '#93a1a1', '#0a4a5a',
    ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5', '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']),
  mk('Solarized Light', 'light', '#fdf6e3', '#657b83', '#586e75', '#d9d2bd',
    ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5', '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']),
  mk('Dracula', 'dark', '#282a36', '#f8f8f2', '#f8f8f2', '#44475a',
    ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2', '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']),
  mk('Nord', 'dark', '#2e3440', '#d8dee9', '#d8dee9', '#434c5e',
    ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0', '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4']),
  mk('Gruvbox Dark', 'dark', '#282828', '#ebdbb2', '#ebdbb2', '#504945',
    ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984', '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2']),
  mk('Monokai', 'dark', '#272822', '#f8f8f2', '#f8f8f0', '#49483e',
    ['#272822', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2', '#75715e', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5']),
  mk('Ubuntu', 'dark', '#300a24', '#eeeeec', '#eeeeec', '#5c3566',
    ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf', '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec']),
  mk('PuTTY Classic', 'dark', '#000000', '#bbbbbb', '#00ff00', '#3a3a3a',
    ['#000000', '#bb0000', '#00bb00', '#bbbb00', '#0000bb', '#bb00bb', '#00bbbb', '#bbbbbb', '#555555', '#ff5555', '#55ff55', '#ffff55', '#5555ff', '#ff55ff', '#55ffff', '#ffffff'])
];
