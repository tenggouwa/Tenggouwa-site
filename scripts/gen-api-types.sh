#!/usr/bin/env bash
# Regenerate packages/api-types/src/openapi.ts from the FastAPI app's OpenAPI schema.
# Run from repo root: `pnpm gen:api-types`.

set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT_JSON="$HERE/packages/api-types/openapi.json"
OUT_TS="$HERE/packages/api-types/src/openapi.ts"

mkdir -p "$(dirname "$OUT_TS")"

echo "▸ Dumping OpenAPI from FastAPI app..."
(
  cd "$HERE/apps/server"
  ENV=dev PYTHONPATH=app uv run --no-sync python scripts/dump_openapi.py
) > "$OUT_JSON"

echo "▸ Generating TypeScript types via openapi-typescript..."
pnpm -w exec openapi-typescript "$OUT_JSON" -o "$OUT_TS"

echo "✓ Wrote $OUT_TS"
