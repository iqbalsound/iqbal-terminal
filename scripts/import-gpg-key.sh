#!/usr/bin/env bash
# Imports the APT signing key from GitHub secrets and checks it works, with clear error messages.
# Env: APT_GPG_PRIVATE_KEY (armored private key, or the same file base64-encoded), APT_GPG_PASSPHRASE, APT_GPG_KEY_ID
set -euo pipefail
err() { echo "::error::$*"; exit 1; }

key="${APT_GPG_PRIVATE_KEY:-}"
[ -n "$key" ] || err "Secret APT_GPG_PRIVATE_KEY is empty or missing. Add it in Settings > Secrets and variables > Actions (the name is case-sensitive)."
key=$(printf '%s' "$key" | tr -d '\r')

if ! printf '%s' "$key" | grep -q 'BEGIN PGP PRIVATE KEY BLOCK'; then
  decoded=$(printf '%s' "$key" | base64 -d 2>/dev/null || true)
  if printf '%s' "$decoded" | grep -q 'BEGIN PGP PRIVATE KEY BLOCK'; then
    key="$decoded"
  elif printf '%s' "$key" | grep -q 'BEGIN PGP PUBLIC KEY BLOCK'; then
    err "APT_GPG_PRIVATE_KEY contains the PUBLIC key. Export the private one: gpg --armor --export-secret-keys <FINGERPRINT>"
  else
    err "APT_GPG_PRIVATE_KEY is not a private key. It must start with -----BEGIN PGP PRIVATE KEY BLOCK----- (or be that file base64-encoded)."
  fi
fi
if [ "$(printf '%s\n' "$key" | wc -l)" -lt 5 ]; then
  err "The key lost its line breaks while pasting. Store it base64-encoded instead:  base64 -w0 ~/apt-secret-key.asc  and paste that single line."
fi

printf '%s\n' "$key" | gpg --batch --yes --pinentry-mode loopback --passphrase "${APT_GPG_PASSPHRASE:-}" --import \
  || err "gpg could not import the key (see the lines above)."
gpg --list-secret-keys --keyid-format long

if [ -n "${APT_GPG_KEY_ID:-}" ] && ! gpg --list-secret-keys "$APT_GPG_KEY_ID" >/dev/null 2>&1; then
  err "APT_GPG_KEY_ID ($APT_GPG_KEY_ID) does not match the imported key. Use the 40-character fingerprint listed above."
fi
echo test | gpg --batch --yes --pinentry-mode loopback --passphrase "${APT_GPG_PASSPHRASE:-}" --default-key "${APT_GPG_KEY_ID:?APT_GPG_KEY_ID is missing}" --clearsign >/dev/null 2>&1 \
  || err "Signing test failed: APT_GPG_PASSPHRASE is wrong for this key (or the key cannot sign)."
echo "Signing key OK"
