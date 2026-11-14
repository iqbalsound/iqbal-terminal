# Releasing Iqbal Terminal

Everything is released by pushing a **tag over SSH**. You do not need the GitHub CLI (`gh`) or the website.
GitHub's servers (Actions) build the installers and attach them to a Release using the built-in token.

## 1. One-time Git over SSH setup
```bash
ssh-keygen -t ed25519 -C "iqbalsound@yahoo.com"
cat ~/.ssh/id_ed25519.pub            # paste into GitHub > Settings > SSH and GPG keys
ssh -T git@github.com                # should greet you by name
git remote add origin git@github.com:iqbalsound/iqbal-terminal.git
git push -u origin main
```
Then change `homepage` in `package.json` to your repository URL and commit.

## 2. Cut a release
```bash
# 1. set "version" in package.json (already 2.0.0), commit
git commit -am "Release 2.0.0"
# 2. tag and push (both over SSH)
git tag -a v2.0.0 -m "Iqbal Terminal 2.0.0"
git push origin main
git push origin v2.0.0
```
The tag starts the workflows in `.github/workflows/` (Windows and Linux). The APT, Snap and Flatpak workflows are parked in
`.github/workflows-optional/` because they need secrets; move one into `.github/workflows/` (`git mv`) once its setup below is done.
Watch runs in the repository's **Actions** tab.

| Workflow | Produces | Needs |
|---|---|---|
| `release-windows.yml` | `Iqbal-Terminal-Setup-2.0.0.exe` attached to the Release | nothing (optional signing secrets) |
| `release-linux.yml` | `.deb`, `.rpm`, `.pacman`, `.AppImage` attached to the Release | nothing |
| `release-apt.yml` | Signed APT repository on the `gh-pages` branch | GPG key + 3 secrets (section 4) |
| `release-snap.yml` | Snap uploaded to the Snap Store | Snap Store account + 1 secret (section 5) |
| `release-flatpak.yml` | `.flatpak` bundle attached to the Release | nothing (not tested, section 6) |

Only want the Windows EXE? Delete the other workflow files, or run `release-windows.yml` by hand from the Actions tab.
Never commit installers into git (they are 100+ MB); they live in Releases.

## 3. "Unknown publisher" on Windows
The installer already carries your name, MIT license page and version. Windows still shows **Unknown publisher**
because the file is not *digitally signed*; that cannot be fixed by metadata. Options:

1. **Public certificate (removes the warning for everyone).** Buy an OV/EV code-signing certificate, or use Azure Trusted Signing,
   or apply to SignPath Foundation (free for open-source projects). Put the `.pfx` (base64) in repository secret `WIN_CSC_LINK`
   and its password in `WIN_CSC_KEY_PASSWORD`; `release-windows.yml` signs automatically. A new OV certificate may still show a
   SmartScreen warning until the file builds reputation; EV and Trusted Signing avoid most of that.
2. **Self-signed (only your own PCs).** Run `scripts/windows/make-signing-cert.ps1` once, then build with `CSC_LINK` / `CSC_KEY_PASSWORD`.
   Your PCs show "Iqbal Uddin Khan" as the publisher; other people's PCs still warn.

## 4. APT repository (Debian, Ubuntu, Kubuntu, Mint)
One-time setup:
```bash
gpg --quick-generate-key "Iqbal Terminal Releases <iqbalsound@yahoo.com>" ed25519 sign 5y
gpg --list-secret-keys --keyid-format long             # note the key ID
gpg --armor --export-secret-keys <KEYID>               # copy the whole block
```
Add repository secrets: `APT_GPG_PRIVATE_KEY` (that block), `APT_GPG_PASSPHRASE`, `APT_GPG_KEY_ID`.
Enable GitHub Pages for the `gh-pages` branch (Settings > Pages) after the first run, or host the folder yourself over SSH:
```bash
scripts/make-apt-repo.sh apt-site dist/iqbal-terminal-2.0.0.amd64.deb <KEYID>
rsync -avz apt-site/ you@your-server:/var/www/apt/
```
Users install with:
```bash
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://iqbalsound.github.io/iqbal-terminal/iqbal-terminal-archive-keyring.gpg | sudo tee /etc/apt/keyrings/iqbal-terminal.gpg >/dev/null
echo "deb [signed-by=/etc/apt/keyrings/iqbal-terminal.gpg] https://iqbalsound.github.io/iqbal-terminal stable main" | sudo tee /etc/apt/sources.list.d/iqbal-terminal.list
sudo apt update && sudo apt install iqbal-terminal
```
This is a **third-party repository** (like Google Chrome's), not the official Debian/Ubuntu archives.

## 5. Snap Store
```bash
sudo snap install snapcraft --classic
snapcraft login
snapcraft register iqbal-terminal            # the name must be free; pick another if taken
snapcraft export-login --snaps iqbal-terminal --channels stable --acls package_access,package_push,package_release credentials.txt
```
Put the contents of `credentials.txt` in repository secret `SNAPCRAFT_STORE_CREDENTIALS`, then push a tag.
The snap is *strictly confined*. After install users run `snap connect iqbal-terminal:ssh-keys` so the app can read `~/.ssh`.
Without that, or if you want unrestricted file transfers, request **classic** confinement on forum.snapcraft.io (manual review).
Test locally first: `npm run dist:snap`, then `sudo snap install --dangerous dist/*.snap`.

## 6. Flatpak
`release-flatpak.yml` builds an installable bundle (`flatpak install --user iqbal-terminal-2.0.0.flatpak`).
**Flathub** (the public store) is a separate process: fork `github.com/flathub/flathub`, add a manifest and open a pull request;
reviewers must approve. Before submitting you must (a) use an app ID tied to a domain or GitHub account you control
(for example `io.github.iqbalsound.IqbalTerminal`; change `appId` in `package.json`), (b) make the build run from source
without network access, and (c) check the runtime version in `package.json` (`runtimeVersion`) is still supported.
Until then, ship the `.flatpak` bundle from your Releases page.

## 7. Version checklist
`package.json` version, `build/linux/*.metainfo.xml` release entry, `README.md` file names, then tag `vX.Y.Z`.
