#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ ! -x bin/api || ! -f apps/web/dist/index.html || ! -d node_modules ]]; then
  echo 'Build first with ./scripts/build.sh.' >&2
  exit 1
fi
# Local preview of both built applications, not a production hosting setup.
# Concurrently forwards termination signals and stops the sibling on any exit.
exec node --env-file-if-exists=.env node_modules/concurrently/dist/bin/index.js \
  --kill-others --names api,web \
  './bin/api' \
  'node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 5173 --strictPort'
