#!/usr/bin/env bash
# Weekly live check with the test account, on this computer: Migros blocks
# logins from GitHub's servers (Cloudflare bot check), so this can't run there.
#
# Checks out the latest main into its own folder (your working copy and its
# node_modules stay untouched), builds it and runs
# `npm run live-account -- --write` with the credentials in .env.live of this
# repo and a saved test login of its own, so most runs need no new login.
#
# Run by scripts/systemd/migros-live-check.timer; by hand: scripts/migros-live-check.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state="${XDG_STATE_HOME:-$HOME/.local/state}/migros-live-check"
src="$state/main"
env_file="${MIGROS_LIVE_ENV_FILE:-$repo/.env.live}"
ref="${MIGROS_LIVE_REF:-main}" # another branch, to try a change before it is merged

[ -f "$env_file" ] || { echo "no credentials: $env_file is missing" >&2; exit 2; }
umask 077
mkdir -p "$state"

git -C "$repo" fetch --quiet origin "$ref"
if [ -d "$src/.git" ] || [ -f "$src/.git" ]; then
  git -C "$src" checkout --quiet --detach "origin/$ref"
else
  git -C "$repo" worktree add --quiet --detach "$src" "origin/$ref"
fi
echo "checking $(git -C "$src" log -1 --format='%h %s')"

cd "$src"
npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
npm run --silent build
MIGROS_LIVE_ENV_FILE="$env_file" MIGROS_LIVE_SESSION_DIR="$state/session" \
  npm run --silent live-account -- --write
