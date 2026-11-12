#!/usr/bin/env bash
# Weekly live check with the test account, on this computer: Migros blocks
# logins from GitHub's servers (Cloudflare bot check), so this can't run there.
#
# It checks what people install: the published image, ghcr.io/herp75/migros-mcp
# (tag `edge`, built from main, unless MIGROS_LIVE_IMAGE_TAG says otherwise).
#   1. Pull the image and pin this run to its digest.
#   2. Verify its keyless cosign signature: built by this repo's docker.yml on
#      main or on a release tag. (Skipped only with MIGROS_LIVE_SKIP_VERIFY=1.)
#   3. Take scripts/live-account-check.mjs from the commit the image was built
#      from (its org.opencontainers.image.revision label), so check and server
#      match.
#   4. Run the check inside the image with rootless podman: read-only root, no
#      capabilities, no new privileges. The container sees only the check
#      script, the credentials file (read-only) and its own saved test login.
#      Nothing is built or run outside the container.
#
# Run by scripts/systemd/migros-live-check.timer; by hand: scripts/migros-live-check.sh
# To try a change before it is merged, run `npm run build && npm run live-account -- --write`
# in a checkout of that branch instead.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state="${XDG_STATE_HOME:-$HOME/.local/state}/migros-live-check"
env_file="${MIGROS_LIVE_ENV_FILE:-$repo/.env.live}"
image="ghcr.io/herp75/migros-mcp:${MIGROS_LIVE_IMAGE_TAG:-edge}"
identity='^https://github\.com/herp75/migros-mcp/\.github/workflows/docker\.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+)$'
podman=(podman --cgroup-manager=cgroupfs)

[ -f "$env_file" ] || { echo "no credentials: $env_file is missing" >&2; exit 2; }
umask 077
mkdir -p "$state/session" "$state/check"

"${podman[@]}" pull --quiet "$image" >/dev/null
digest="$("${podman[@]}" image inspect "$image" --format '{{index .RepoDigests 0}}')"
case "$digest" in
  ghcr.io/herp75/migros-mcp@sha256:*) ;;
  *) echo "unexpected image reference: $digest" >&2; exit 1 ;;
esac

if [ "${MIGROS_LIVE_SKIP_VERIFY:-}" = 1 ]; then
  echo "warning: signature not checked (MIGROS_LIVE_SKIP_VERIFY=1)" >&2
else
  command -v cosign >/dev/null || { echo "cosign is needed to check the image signature" >&2; exit 2; }
  cosign verify "$digest" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    --certificate-identity-regexp "$identity" >/dev/null 2>&1 \
    || { echo "the signature of $digest does not verify, not running it" >&2; exit 1; }
fi

rev="$("${podman[@]}" image inspect "$digest" --format '{{index .Labels "org.opencontainers.image.revision"}}')"
[[ "$rev" =~ ^[0-9a-f]{40}$ ]] || { echo "the image names no source commit" >&2; exit 1; }
git -C "$repo" fetch --quiet origin
git -C "$repo" show "$rev:scripts/live-account-check.mjs" >"$state/check/live-account-check.mjs"
echo "checking $digest, built from $(git -C "$repo" log -1 --format='%h %s' "$rev")"

# keep-id runs the container as this user, so it can read the mode-600 credentials
# file and write the saved login; :Z labels the mounts for SELinux.
"${podman[@]}" run --rm --pull=never \
  --userns=keep-id --user "$(id -u):$(id -g)" \
  --read-only --tmpfs /tmp --cap-drop=ALL --security-opt=no-new-privileges \
  -v "$state/check:/app/scripts:ro,Z" \
  -v "$env_file:/run/live.env:ro,Z" \
  -v "$state/session:/session:Z" \
  -e MIGROS_LIVE_ENV_FILE=/run/live.env \
  -e MIGROS_LIVE_SESSION_DIR=/session \
  --entrypoint node \
  "$digest" /app/scripts/live-account-check.mjs --write
