#!/usr/bin/env bash
# Diario 08:00: POS->232 incremental (dias nuevos + OC abiertas) y GCP
# orden_compra + orden_compra_linea (upsert de las tablas locales; no el sync general).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

# OJO con set -e: sin el "|| code=$?" un fallo aborta el script ANTES de leer
# $?, asi que la tolerancia al codigo 3 nunca se aplicaba.
code=0
python3 scripts/etl/orden-compra/etl_orden_compra.py --incremental || code=$?
if [[ "$code" -ne 0 && "$code" -ne 3 ]]; then
  exit "$code"
fi

# Segunda pasada: las entradas REALES de inventario (ET/EF) no viven en
# cmmovimiento_ocompra sino en cmmovimiento_inventario, y esa rama del ETL solo
# corre bajo --solo-et-ef. Sin esta linea el feed se congela: estuvo parado en
# 20260818 mientras FR/OC/OM/OS seguian al dia, y el tablero de costos se
# quedaba sin la entrada del dia para resolver kilos y costo por proveedor.
code_ef=0
python3 scripts/etl/orden-compra/etl_orden_compra.py --incremental --solo-et-ef || code_ef=$?
if [[ "$code_ef" -ne 0 && "$code_ef" -ne 3 ]]; then
  exit "$code_ef"
fi

# --only: no toca ventas/margen/rotacion. Sin --days: tabla OC completa (incluye
# incompletas viejas ya refrescadas). --no-refresh: matview de rotacion la hace el 07:50.
sync_code=0
bash scripts/etl/sync-local-to-gcp.sh --only orden_compra --only orden_compra_linea --no-refresh --verify || sync_code=$?
if [[ "$sync_code" -ne 0 && "$sync_code" -ne 3 ]]; then
  exit "$sync_code"
fi
exit "$code"
