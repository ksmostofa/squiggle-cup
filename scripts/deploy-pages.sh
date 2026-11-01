#!/usr/bin/env bash
# Deploys a copy of the game's frontend to Cloudflare Pages. The Workers
# deployment (npm run deploy) stays the primary site and keeps running; this
# copy uses the same room relay and the same leaderboard, so players on
# either address can share rooms and boards. Needs `npx wrangler login` once.
#
# Pages deployment config. `wrangler pages deploy` doesn't take a config file,
# so the settings live here.
PROJECT="${PAGES_PROJECT:-squigglecup}"                                  # → https://squigglecup.pages.dev
BRANCH="${PAGES_BRANCH:-main}"                                           # production branch
RELAY="${RELAY_URL:-wss://squiggle-cup-relay.ksmostofa576.workers.dev/relay}"
API="${API_URL:-https://squiggle-cup.ksmostofa576.workers.dev/api/board}" # the Worker's leaderboard (CORS open)
OUT=dist-pages
set -euo pipefail
cd "$(dirname "$0")/.."

npx wrangler pages project list 2>/dev/null | grep -q " $PROJECT " ||
  npx wrangler pages project create "$PROJECT" --production-branch "$BRANCH" --force # --force: a classic Pages project on pages.dev, not a Worker

VITE_RELAY_URL="$RELAY" VITE_API_URL="$API" npx vite build --outDir "$OUT" --emptyOutDir
npx wrangler pages deploy "$OUT" --project-name "$PROJECT" --branch "$BRANCH" --commit-dirty=true

site="https://$PROJECT.pages.dev"
# A new pages.dev name can take a minute to resolve.
for i in $(seq 1 30); do
  curl --fail --silent "$site/" | grep -q '<title>Squiggle Cup</title>' && { echo "Pages verified: $site"; exit 0; }
  sleep 5
done
echo "Deployed, but $site did not answer with the game yet." >&2
exit 1
