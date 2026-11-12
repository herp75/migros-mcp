#!/usr/bin/env bash
# Fail if tracked source turns off TLS certificate checks or binds to all interfaces.
# Tests and docs may mention these patterns (to test that they are rejected); nothing else may.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

pattern='rejectUnauthorized[[:space:]]*:[[:space:]]*false|NODE_TLS_REJECT_UNAUTHORIZED|checkServerIdentity[[:space:]]*:|strictSSL[[:space:]]*:[[:space:]]*false|insecureHTTPParser|0\.0\.0\.0|::/0'
allow=(':!tests/' ':!docs/' ':!*.md' ':!scripts/check-insecure-patterns.sh' ':!package-lock.json')

if matches=$(git grep --untracked -nIE "$pattern" -- . "${allow[@]}"); then
  echo "Insecure pattern found (TLS certificate checks must stay on; nothing listens on all interfaces):"
  echo "$matches"
  exit 1
fi
echo "No insecure patterns found."
