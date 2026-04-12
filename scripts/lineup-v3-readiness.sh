#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

./dev check
npm --prefix cli exec vitest run cli/test/differential-regression.test.ts

printf 'Lineup v3 readiness checks passed at %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
