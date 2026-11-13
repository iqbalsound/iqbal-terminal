# Iqbal Terminal

A multi-session SSH terminal (PuTTY / MobaXterm style) with floating picture-in-picture windows and a built-in rich text editor.

**Author:** Iqbal Uddin Khan <iqbalsound@yahoo.com> · **License:** MIT · **Version:** 1.1.0

## Features
- Multiple SSH tabs, saved sessions with groups, import/export (passwords are never exported), quick connect `user@host:port`
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
| Debian, Ubuntu, Kubuntu, Mint | `sudo apt install ./iqbal-terminal-1.1.0.amd64.deb` |
| Fedora, RHEL, openSUSE | `sudo dnf install ./iqbal-terminal-1.1.0.x86_64.rpm` |
| Arch, Manjaro, EndeavourOS (pacman) | `sudo pacman -U ./iqbal-terminal-1.1.0.x64.pacman` |
| Any Linux | `chmod +x iqbal-terminal-1.1.0-x86_64.AppImage && ./iqbal-terminal-1.1.0-x86_64.AppImage` |
| Windows 10/11 | run `Iqbal-Terminal-Setup-1.1.0.exe` (unsigned: SmartScreen > More info > Run anyway) |

## Build from source
```bash
npm install
npm start                 # run
npm run dist:linux        # DEB, RPM, pacman, AppImage (needs rpm, libarchive-tools, zstd)
npm run dist:win          # Windows installer (on Windows, or Linux with wine + wine32)
```

## Publish to GitHub over SSH
```bash
ssh-keygen -t ed25519 -C "iqbalsound@yahoo.com"      # once
cat ~/.ssh/id_ed25519.pub                             # add at GitHub > Settings > SSH and GPG keys
ssh -T git@github.com                                 # test
git remote add origin git@github.com:<your-username>/iqbal-terminal.git
git push -u origin main
git tag v1.1.0 && git push origin v1.1.0              # the workflow builds all installers and attaches them to a release
```

## License
MIT. See [LICENSE](LICENSE).
