#!/usr/bin/env bash
# Deploys the room relay (Worker + Durable Object), then the game to
# a separate Worker with static assets. Needs `npx wrangler login` once.
set -euo pipefail
cd "$(dirname "$0")/.."

out=$(npx wrangler deploy --config wrangler.toml 2>&1 | tee /dev/stderr)
host=$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' <<<"$out" | head -1)
[ -n "$host" ] || { echo "Could not find the relay URL in wrangler's output." >&2; exit 1; }
relay="wss://${host#https://}/relay"
echo "Relay: $relay"

VITE_RELAY_URL="$relay" npm run build
out=$(npx wrangler deploy --config wrangler.site.toml 2>&1 | tee /dev/stderr)
site=$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' <<<"$out" | head -1)
[ -n "$site" ] || { echo "Could not find the game URL in wrangler's output." >&2; exit 1; }
# A relay's text response also returns 200. Check the document, not just status.
curl --fail --silent --show-error "$site/" | grep -q '<title>Squiggle Cup</title>'
echo "Game verified: $site"
