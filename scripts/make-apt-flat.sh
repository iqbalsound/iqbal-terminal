#!/usr/bin/env bash
# Builds a signed "flat" APT repository (no pool/dists folders) so every file can be a GitHub Release asset.
# Usage: scripts/make-apt-flat.sh <out-dir> <path-to.deb> <gpg-key-id-or-fingerprint>
# Optional env: APT_GPG_PASSPHRASE (for a passphrase-protected key)
set -euo pipefail
OUT=${1:?out dir}; DEB=${2:?path to .deb}; KEY=${3:?gpg key id}
for t in apt-ftparchive gpg gzip; do command -v "$t" >/dev/null || { echo "missing tool: $t (sudo apt install apt-utils gnupg)"; exit 1; }; done
GPG=(gpg --batch --yes --default-key "$KEY")
[ -n "${APT_GPG_PASSPHRASE:-}" ] && GPG+=(--pinentry-mode loopback --passphrase "$APT_GPG_PASSPHRASE")

rm -rf "$OUT"; mkdir -p "$OUT"; cp -f "$DEB" "$OUT/"
cd "$OUT"
apt-ftparchive packages . | sed 's#^Filename: \./#Filename: #' > Packages
gzip -9kf Packages
mkdir .idx && cp Packages Packages.gz .idx/
apt-ftparchive -o APT::FTPArchive::Release::Origin="Iqbal Terminal" -o APT::FTPArchive::Release::Label="Iqbal Terminal" \
  -o APT::FTPArchive::Release::Architectures=amd64 release .idx > Release
rm -rf .idx
"${GPG[@]}" -abs -o Release.gpg Release
"${GPG[@]}" --clearsign -o InRelease Release
gpg --batch --yes --export "$KEY" > iqbal-terminal-archive-keyring.gpg
gpg --batch --yes --armor --export "$KEY" > iqbal-terminal-archive-keyring.asc
echo "Flat APT repository ready in $OUT:"; ls -la
