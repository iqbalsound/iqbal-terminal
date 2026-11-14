# Iqbal Terminal

A multi-session SSH terminal (PuTTY / MobaXterm style) with an SFTP file manager, floating picture-in-picture windows and a built-in rich text editor.

**Author:** Iqbal Uddin Khan <iqbalsound@yahoo.com> · **License:** MIT · **Version:** 2.0.0

## Features
- Multiple SSH tabs, saved sessions with groups, import/export (passwords are never exported), quick connect `user@host:port`
- **File manager (Ctrl+Shift+D):** browse the remote server beside your terminal; upload and download files or whole folders (button or drag and drop from your desktop), with progress and cancel; new folder, rename, delete; works over the existing login
- **Themes:** dark, light and black-and-green *Matrix*, plus 11 terminal color schemes
- **PiP mode:** pop any session out into its own always-on-top floating window (Ctrl+Shift+P). Run as many as you like, resize them, change transparency, then dock them back into a tab (closing a PiP window also docks it)
- Keys: PEM, OpenSSH and PuTTY PPK (v2 and v3; RSA, ECDSA, Ed25519), passphrases, passwords, ssh-agent / Pageant
- Host-key verification (trust on first use, warning when a key changes)
- Dark and light UI, 10 terminal color schemes, bundled and system fonts, adjustable size
- Ctrl+C copies when text is selected (otherwise sends interrupt), Ctrl+V pastes, Ctrl+Shift+C / Ctrl+Shift+V always copy / paste
- Runs in the system tray and keeps sessions alive in the background
- **Editor tab (Ctrl+Shift+E):** clean WYSIWYG editor with headings, bold, italic, underline, strikethrough, lists, quotes, code, links; opens and saves Markdown, plain text and HTML; can send text straight to an SSH session
- Passwords are stored only when the OS keyring is available (DPAPI / Keychain / libsecret / KWallet)

## Install
| Platform | Package |
|---|---|
| Debian, Ubuntu, Kubuntu, Mint | `sudo apt install ./iqbal-terminal-2.0.0.amd64.deb` (or the APT repository in docs/RELEASING.md) |
| Fedora, RHEL, openSUSE | `sudo dnf install ./iqbal-terminal-2.0.0.x86_64.rpm` |
| Arch, Manjaro, EndeavourOS (pacman) | `sudo pacman -U ./iqbal-terminal-2.0.0.x64.pacman` |
| Any Linux | `chmod +x iqbal-terminal-2.0.0-x86_64.AppImage && ./iqbal-terminal-2.0.0-x86_64.AppImage` |
| Windows 10/11 | run `Iqbal-Terminal-Setup-2.0.0.exe` (unsigned: SmartScreen > More info > Run anyway) |

## Build from source
```bash
npm install
npm start                 # run
npm run dist:linux        # DEB, RPM, pacman, AppImage (needs rpm, libarchive-tools, zstd)
npm run dist:win          # Windows installer (on Windows, or Linux with wine + wine32)
```

## Releasing
See [docs/RELEASING.md](docs/RELEASING.md): push a tag over SSH and the workflows in `.github/workflows/` build the Windows EXE, Linux packages, APT repository, Snap and Flatpak.

## License
MIT. See [LICENSE](LICENSE).
