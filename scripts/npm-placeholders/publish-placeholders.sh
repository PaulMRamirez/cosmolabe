#!/usr/bin/env sh
# One-time name reservation. Prereqs: npm account with WebAuthn/passkey 2FA,
# `npm login` (two-hour session), and the cosmolabe org created on npmjs.com
# (org creation is what reserves the @cosmolabe scope; no publish needed for it).
set -e
cd "$(dirname "$0")"
for name in cosmolabe cspice-wasm besselian; do
  ( cd "$name" && npm publish )
  npm deprecate "$name@0.0.0" "Reserved for the Cosmolabe project; first real release is 0.1.0. See https://github.com/PaulMRamirez/cosmolabe"
done
echo "Both names claimed and deprecation notices set."
