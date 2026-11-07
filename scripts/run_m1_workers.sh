#!/usr/bin/env bash
# Runs the M1 job workers against the local stack, one process per job type, until Ctrl-C.
# For testing the X-ray flow on this machine (docs/extract-api.md). Local stack only.
set -euo pipefail
cd "$(dirname "$0")/.."

pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM
for type in collect xray_neighborhood xray_pair xray_calc render_xray; do
  node scripts/with-local-env.mjs uv run worker "$type" --local &
  pids+=("$!")
done
wait
