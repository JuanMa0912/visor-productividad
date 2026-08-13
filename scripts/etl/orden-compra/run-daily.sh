#!/usr/bin/env bash
# Diario 08:00: POS->232 incremental (dias nuevos + OC abiertas) y GCP solo
# orden_compra (upsert de toda la tabla local; no el sync general).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

python3 scripts/etl/orden-compra/etl_orden_compra.py --incremental
code=$?
if [[ "$code" -ne 0 && "$code" -ne 3 ]]; then
  exit "$code"
fi

# --only: no toca ventas/margen/rotacion. Sin --days: tabla OC completa (incluye
# incompletas viejas ya refrescadas). --no-refresh: matview de rotacion la hace el 07:50.
bash scripts/etl/sync-local-to-gcp.sh --only orden_compra --no-refresh --verify
sync_code=$?
if [[ "$sync_code" -ne 0 && "$sync_code" -ne 3 ]]; then
  exit "$sync_code"
fi
exit "$code"
