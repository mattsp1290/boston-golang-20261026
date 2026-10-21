#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
command -v node >/dev/null || { echo 'Node.js 24.15+ (24.x) or 26+ is required.' >&2; exit 1; }
command -v npm >/dev/null || { echo 'npm 10+ is required.' >&2; exit 1; }
command -v go >/dev/null || { echo 'Go 1.26+ is required.' >&2; exit 1; }
npm ci
npm run build
