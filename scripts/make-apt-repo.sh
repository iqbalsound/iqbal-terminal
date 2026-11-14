#!/usr/bin/env bash
# Builds (or updates) a signed APT repository directory that you can host on any static web server.
# Usage: scripts/make-apt-repo.sh <site-dir> <path-to.deb> <gpg-key-id-or-email>
# Optional: APT_GPG_PASSPHRASE for a passphrase-protected key (used in CI).
set -euo pipefail
SITE=${1:?site dir}; DEB=${2:?path to .deb}; KEY=${3:?gpg key id or email}
for t in apt-ftparchive gpg gzip; do command -v "$t" >/dev/null || { echo "missing tool: $t (sudo apt install apt-utils gnupg)"; exit 1; }; done
GPG=(gpg --batch --yes --default-key "$KEY")
[ -n "${APT_GPG_PASSPHRASE:-}" ] && GPG+=(--pinentry-mode loopback --passphrase "$APT_GPG_PASSPHRASE")

mkdir -p "$SITE/pool/main" "$SITE/dists/stable/main/binary-amd64"
cp -f "$DEB" "$SITE/pool/main/"
cd "$SITE"
apt-ftparchive packages pool > dists/stable/main/binary-amd64/Packages
gzip -9kf dists/stable/main/binary-amd64/Packages
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin="Iqbal Terminal" -o APT::FTPArchive::Release::Label="Iqbal Terminal" \
  -o APT::FTPArchive::Release::Suite=stable -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Architectures=amd64 -o APT::FTPArchive::Release::Components=main \
  release dists/stable > dists/stable/Release.new
mv dists/stable/Release.new dists/stable/Release
"${GPG[@]}" -abs -o dists/stable/Release.gpg dists/stable/Release
"${GPG[@]}" --clearsign -o dists/stable/InRelease dists/stable/Release
gpg --batch --yes --armor --export "$KEY" > iqbal-terminal-archive-keyring.asc
gpg --batch --yes --export "$KEY" > iqbal-terminal-archive-keyring.gpg
cat > index.html <<'HTML'
<!doctype html><meta charset="utf-8"><title>Iqbal Terminal APT repository</title>
<h1>Iqbal Terminal APT repository</h1>
<pre>
sudo mkdir -p /etc/apt/keyrings
curl -fsSL URL_HERE/iqbal-terminal-archive-keyring.gpg | sudo tee /etc/apt/keyrings/iqbal-terminal.gpg &gt;/dev/null
echo "deb [signed-by=/etc/apt/keyrings/iqbal-terminal.gpg] URL_HERE stable main" | sudo tee /etc/apt/sources.list.d/iqbal-terminal.list
sudo apt update &amp;&amp; sudo apt install iqbal-terminal
</pre>
HTML
echo "APT repository ready in $SITE"
