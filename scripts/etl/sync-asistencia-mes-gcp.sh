#!/usr/bin/env bash
# Sube asistencia_horas del MES-A-LA-FECHA a GCP (replace). Pensado para el timer
# systemd de las 18:30, despues de que la tarea de Windows cierre las horas en la
# local (corre en la manana y a las 18:00; se le da margen hasta 18:30).
#
# Rango = primer dia del mes de AYER  ->  AYER (dias ya completos):
#   - dia 8  ->  2026-08-01 .. 2026-08-07
#   - dia 1  ->  re-sube el MES ANTERIOR completo (2026-07-01 .. 2026-07-31), asi el
#                ultimo dia del mes no queda sin subir cuando cambia el mes.
#
# asistencia_horas va SIEMPRE en modo replace en el sync -> borra ese rango de fechas
# en GCP y reinserta lo de la local. Es idempotente y auto-corrige ediciones
# retroactivas del biometrico (si un dia del mes cambio en la local, se re-sube).
set -euo pipefail

DIR="/home/prodapp/visor-productividad"

# GNU date (Linux). "ayer" define el mes: en el dia 1 apunta al mes anterior.
DESDE="$(date -d 'yesterday' +%Y-%m-01)"
HASTA="$(date -d 'yesterday' +%Y-%m-%d)"

echo "[$(date '+%F %T')] asistencia_horas -> GCP | rango [$DESDE .. $HASTA]"

exec /bin/bash "$DIR/scripts/etl/sync-local-to-gcp.sh" \
  --only asistencia_horas --desde "$DESDE" --hasta "$HASTA" --no-refresh --verify
