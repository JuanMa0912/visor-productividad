#!/usr/bin/env bash
# Watchdog de salud para Visor de Productividad.
# LISTO PARA CONFIGURAR — no esta activo hasta que lo pongas en cron.
#
# Por que: PM2 no tiene liveness HTTP. Si el proceso queda "pegado-pero-vivo"
# (pool agotado / event loop bloqueado) no crashea, asi que PM2 no lo reinicia.
# Este script sondea /api/health y reinicia la app tras N fallos seguidos.
#
# Instalar (cron del usuario prodapp, que corre PM2), cada minuto:
#   chmod +x /home/prodapp/visor-productividad/deploy/healthcheck.sh
#   crontab -e
#   * * * * * /home/prodapp/visor-productividad/deploy/healthcheck.sh >> /home/prodapp/vp-healthcheck.log 2>&1
#
# Variables (opcionales):
#   VP_HEALTH_URL        URL del endpoint (default http://127.0.0.1:5600/api/health)
#   VP_PM2_APP           nombre PM2 a reiniciar (default visor-productividad)
#   VP_HEALTH_MAX_FAILS  fallos seguidos antes de reiniciar (default 3)
#   VP_HEALTH_STATE      archivo de estado (default /tmp/vp-health-fails)
set -euo pipefail

URL="${VP_HEALTH_URL:-http://127.0.0.1:5600/api/health}"
APP_NAME="${VP_PM2_APP:-visor-productividad}"
MAX_FAILS="${VP_HEALTH_MAX_FAILS:-3}"
STATE_FILE="${VP_HEALTH_STATE:-/tmp/vp-health-fails}"

fails="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"

# --max-time 12 > connectionTimeoutMillis (10s): si el pool esta agotado, /api/health
# tarda ~10s en responder 503; con menos tiempo el curl cortaria antes y daria falso fallo.
if curl -fsS --max-time 12 "$URL" >/dev/null 2>&1; then
  echo "0" > "$STATE_FILE"
  exit 0
fi

fails=$((fails + 1))
echo "$fails" > "$STATE_FILE"
echo "$(date -Is) health FAIL ($fails/$MAX_FAILS) en $URL"

if [ "$fails" -ge "$MAX_FAILS" ]; then
  echo "$(date -Is) reiniciando $APP_NAME tras $fails fallos seguidos"
  pm2 restart "$APP_NAME" || true
  echo "0" > "$STATE_FILE"
fi
