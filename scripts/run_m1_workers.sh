#!/usr/bin/env bash
# Runs the M1 job workers against the local stack, one process per job type, until Ctrl-C.
# For testing the X-ray flow on this machine (docs/extract-api.md). Local stack only.
set -euo pipefail
cd "$(dirname "$0")/.."

# The AI key (D70) for the local workers, until it moves to a secret manager: Marlon keeps it in .env.workers.local
# (git-ignored by .env.*), e.g. OPENAI_API_KEY=... . Agents never create or read that file.
if [[ -f .env.workers.local ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.workers.local
  set +a
fi

# render_xray prints the result page of the running web app (pnpm dev) into the PDF.
export MARGO_APP_URL="${MARGO_APP_URL:-http://localhost:3000}"

pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM
for type in collect xray_neighborhood xray_pair xray_calc xray_opportunities render_xray; do
  node scripts/with-local-env.mjs uv run worker "$type" --local &
  pids+=("$!")
done
wait
