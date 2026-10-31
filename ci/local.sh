#!/usr/bin/env bash
# A01: a fresh clone passes on the Mac mini with no secret.
#   pnpm i && supabase start && pnpm db:reset && pnpm test, then the full pnpm check.
set -euo pipefail
cd "$(dirname "$0")/.."

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" != "22" ]; then
  echo "ci/local.sh: Node 22 required (found $(node -v)). Try: export PATH=/opt/homebrew/opt/node@22/bin:\$PATH" >&2
  exit 1
fi

# No .env file may exist anywhere in the tree; secrets live only in the platforms (D44).
if find . -name '.env*' ! -name '.env.example' -not -path './node_modules/*' -not -path '*/node_modules/*' | grep -q .; then
  echo "ci/local.sh: found a .env file; remove it (secrets live only in Vercel, Maritime, Supabase)" >&2
  exit 1
fi

pnpm i --frozen-lockfile
uv sync --frozen
supabase start
pnpm db:reset
pnpm test
pnpm check
echo "ci/local.sh: ok"
