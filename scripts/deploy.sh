#!/usr/bin/env bash
# Deploys the room relay (Worker + Durable Object), then the game to
# Cloudflare Pages pointed at it. Needs `npx wrangler login` once.
set -euo pipefail
cd "$(dirname "$0")/.."

out=$(npx wrangler deploy 2>&1 | tee /dev/stderr)
host=$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' <<<"$out" | head -1)
[ -n "$host" ] || { echo "Could not find the relay URL in wrangler's output." >&2; exit 1; }
relay="wss://${host#https://}/relay"
echo "Relay: $relay"

VITE_RELAY_URL="$relay" npm run build
npx wrangler pages project create squiggle-cup --production-branch main 2>/dev/null || true
npx wrangler pages deploy dist --project-name squiggle-cup --branch main --commit-dirty=true
