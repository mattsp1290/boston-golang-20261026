#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v node >/dev/null || { echo 'Node.js 24.15+ (24.x) or 26+ is required.' >&2; exit 1; }
# Node parses .env as data, never as shell commands.
exec node "$ROOT/scripts/run.mjs" "$@"
