# Despliegue Linux

Runbook estable para operar el portal en una VM Linux. Para la limpieza semanal
de logs/sesiones ver tambien [`../deploy/README.md`](../deploy/README.md).

Estado de referencia: codigo versionado revisado el **2026-06-10**.

## 1. Modelo recomendado

```text
nginx / HTTPS
  -> Node.js ejecutando Next standalone o next start
    -> PostgreSQL
    -> Notion (solo /cronograma)
    -> bases PostgreSQL DIAN (solo /ExcelDian)
```

HTTPS es el estado recomendado. HTTP plano solo debe usarse como etapa temporal
en red confiable.

## 2. Variables minimas

Configurar en `.env.local` del servidor. No versionar secretos.

```bash
DB_HOST=...
DB_PORT=5432
DB_NAME=produXdia
DB_USER=...
DB_PASSWORD=...
DB_SCHEMA=public
AUDIT_IP_HMAC_SECRET=...
SESSION_COOKIE_SECURE=true
TRUST_PROXY=true
```

Variables por capacidad:

| Capacidad | Variables |
| --- | --- |
| Pool PostgreSQL | `DB_POOL_MAX`, `DB_POOL_CONN_TIMEOUT_MS`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_MAX_LIFETIME_SEC`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_TX_TIMEOUT_MS` (todas opcionales; ver seccion 11) |
| Productividad cache | `PRODUCTIVITY_CACHE_PATH`, `PRODUCTIVITY_SERVE_FILE_CACHE` |
| Build | `NEXT_BUILD_MEMORY_MB`, `NEXT_BUILD_LOG_LIMITS`, `NEXT_BUILD_STRICT` |
| HTTPS/headers | `UPGRADE_INSECURE_REQUESTS`, `COOP_DISABLED`, `ALLOWED_DEV_ORIGINS` |
| Ventas x item v2 | `NEXT_PUBLIC_VENTAS_X_ITEM_USE_V2=1` |
| Notion cronograma | `NOTION_TOKEN`, `NOTION_CRONOGRAMA_PAGE_ID` |
| Excel DIAN | `EXCEL_DIAN_MTDO_DB_*`, `EXCEL_DIAN_MIO_DB_*`, `EXCEL_DIAN_BGT_DB_*` |
| Excel DIAN publico | `EXCEL_DIAN_EXPORT_PUBLIC`, `NEXT_PUBLIC_EXCEL_DIAN_EXPORT_PUBLIC` |

Nota: `CSP_UNSAFE_EVAL` puede existir en ambientes antiguos, pero el CSP actual
incluye `'unsafe-eval'` directamente en `next.config.ts`. No usar esa variable
como control operativo.

## 3. HTTP plano vs HTTPS

### Si hay HTTPS

Usar:

```bash
SESSION_COOKIE_SECURE=true
COOP_DISABLED=false
UPGRADE_INSECURE_REQUESTS=true
TRUST_PROXY=true
```

`TRUST_PROXY=true` permite registrar la IP real si nginx envia
`x-forwarded-for`.

### Si aun no hay HTTPS

Usar temporalmente:

```bash
SESSION_COOKIE_SECURE=false
COOP_DISABLED=true
UPGRADE_INSECURE_REQUESTS=false
```

Motivo:

- cookies `Secure` son rechazadas por navegadores sobre HTTP y causan loop de login;
- COOP `same-origin` se ignora en HTTP y produce warning de consola;
- `upgrade-insecure-requests` puede romper cargas si el sitio sigue en HTTP.

Cuando se habilite HTTPS, revertir esas excepciones.

## 4. Build y arranque

### Instalar dependencias

```bash
cd /opt/visor-productividad
npm ci
```

### Validar antes de publicar

```bash
npm run ci
```

### Build standalone recomendado

```bash
npm run build:release
```

Equivale a build standalone con validacion estricta. Para hosts pequenos se
puede ajustar:

```bash
NEXT_BUILD_MEMORY_MB=1024 npm run build:server
```

### Arrancar

Standalone:

```bash
npm run start:server
```

Next start tradicional:

```bash
npm run start
```

## 5. Ejemplo systemd de la app

El repo no versiona una unidad principal de la app. Ejemplo orientativo:

```ini
[Unit]
Description=Visor Productividad
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=visor
Group=visor
WorkingDirectory=/opt/visor-productividad
EnvironmentFile=/opt/visor-productividad/.env.local
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Si se usa `npm run start`, cambiar `ExecStart` por el comando aprobado para ese
servidor.

## 6. Nginx minimo

```nginx
server {
  listen 443 ssl http2;
  server_name portal.ejemplo.local;

  ssl_certificate /etc/letsencrypt/live/portal.ejemplo.local/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/portal.ejemplo.local/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

Con este proxy, usar `TRUST_PROXY=true`.

## 7. Migraciones y admin inicial

Aplicar `db/schema-auth.sql` y luego migraciones por fecha:

```bash
node scripts/apply-migration-file.mjs db/migrations/20260526_user_activity_log.sql
```

Crear o actualizar admin:

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD='...' node scripts/create-admin.js
```

Verificar conexion:

```bash
npm run db:test
npm run db:test:postgres
```

## 8. Limpieza semanal

Instalar el timer descrito en [`../deploy/README.md`](../deploy/README.md):

```bash
sudo -u visor /opt/visor-productividad/scripts/cleanup-logs.sh --dry-run
sudo systemctl enable --now visor-cleanup-logs.timer
systemctl list-timers visor-cleanup-logs.timer
```

La limpieza borra registros antiguos de `app_user_activity_log`,
`app_user_login_logs` y sesiones expiradas/antiguas en `app_user_sessions`.

## 9. Validacion postdeploy

1. Abrir `/login` y autenticar.
2. Confirmar redireccion a `/secciones`.
3. Confirmar que `/api/auth/me` responde 200.
4. Abrir DevTools y revisar que no haya loop de login ni errores CSP.
5. Probar una exportacion Excel/PDF en un modulo que la use.
6. Probar `/cronograma` si Notion esta configurado.
7. Probar `/ExcelDian` si las bases DIAN estan configuradas.
8. Revisar presencia admin en `/admin/usuarios` y logs en `/admin/usuarios/accesos`.
9. Confirmar `journalctl -u <servicio>` sin errores repetidos.

## 10. Problemas conocidos

| Sintoma | Causa probable | Accion |
| --- | --- | --- |
| Login correcto vuelve a `/login` | cookie `Secure` sobre HTTP | usar HTTPS o `SESSION_COOKIE_SECURE=false` temporal |
| Warning COOP en consola HTTP | COOP requiere origen confiable | usar HTTPS o `COOP_DISABLED=true` temporal |
| Exportaciones fallan por CSP | politica incompatible con librerias | confirmar que el build usa el `next.config.ts` actual |
| IPs aparecen como proxy | falta `TRUST_PROXY=true` o headers nginx | configurar proxy y env |
| Presencia/admin sin datos | faltan migraciones `last_activity`, `last_path` o `user_activity_log` | aplicar migraciones de mayo 2026 |
| `/cronograma` falla | faltan `NOTION_*` o permisos de integracion | revisar token, page id y conexiones en Notion |
| Servidor "pegado", solo revive con `pm2 restart` | pool PostgreSQL agotado sin timeouts (una query trabada retiene conexiones y `pool.connect()` esperaba para siempre) | mitigado por defecto desde Fase 1+2 (timeouts del pool); para auto-recuperacion activar el watchdog de la seccion 11 |

## 11. Resiliencia del pool PostgreSQL y auto-recuperacion

### 11.1 Timeouts del pool (Fase 1+2, ya activos)

El pool principal (`src/lib/db/index.ts`) ahora separa dos cosas distintas:

- **Adquirir conexion** (sacar un client del pool): acotado para fallar rapido en
  vez de colgarse para siempre cuando el pool se agota. Esta era la causa raiz del
  "pegado". No afecta la duracion de las queries.
- **Duracion de query**: techo alto (`statement_timeout` 800s) que solo aborta
  queries trabadas indefinidamente (conexiones zombi). Las queries pesadas reales
  (rotacion, exports) terminan muy por debajo y no se ven afectadas.

Todo es configurable por env con defaults seguros (no requieren accion):

| Variable | Default | Efecto |
| --- | --- | --- |
| `DB_POOL_MAX` | `15` | tamano del pool; revisar contra `max_connections` de la DB |
| `DB_POOL_CONN_TIMEOUT_MS` | `10000` | espera maxima para obtener un client (antes: infinita) |
| `DB_POOL_IDLE_TIMEOUT_MS` | `30000` | cierre de conexiones ociosas |
| `DB_POOL_MAX_LIFETIME_SEC` | `1800` | reciclaje de conexiones (mata zombis de Cloud SQL/NAT) |
| `DB_STATEMENT_TIMEOUT_MS` | `800000` | techo por query (800s); `0` desactiva |
| `DB_IDLE_TX_TIMEOUT_MS` | `60000` | corta transacciones OCIOSas; no toca queries en curso |

Para tightening fino de endpoints livianos existe `withPoolClient(fn, { statementTimeoutMs })`,
que aplica un timeout corto solo a ese client y lo restablece al techo global al
terminar. Las rutas pesadas no lo usan.

Stopgap inmediato del lado de la DB (sin redeploy), si hiciera falta:

```sql
ALTER ROLE <DB_USER> SET statement_timeout = '800s';
ALTER ROLE <DB_USER> SET idle_in_transaction_session_timeout = '60s';
-- aplica a conexiones nuevas; reiniciar la app para tomarlo
```

### 11.2 Auto-recuperacion con PM2 + watchdog (Fase 3, lista para configurar)

PM2 reinicia el proceso si **crashea** o supera memoria, pero NO detecta
"pegado-pero-vivo". El endpoint `GET /api/health` (publico, hace `SELECT 1` y
expone contadores del pool) permite a un watchdog externo detectarlo y reiniciar.

Archivos provistos (no activos hasta configurarlos):

| Archivo | Uso |
| --- | --- |
| `src/app/api/health/route.ts` | health endpoint (`200` ok / `503` DB caida) |
| `deploy/ecosystem.config.js` | config PM2 (1 proceso, `max_memory_restart`) |
| `deploy/healthcheck.sh` | sonda `/api/health` y reinicia tras N fallos |

Entorno real de producción: usuario `prodapp`, repo en `/home/prodapp/visor-productividad`,
proceso PM2 `visor-productividad` corriendo `npm start -- -p 5600` (next start en el
**puerto 5600**), modo fork.

Probar el endpoint (no requiere activar nada más; ya viene en el build):

```bash
curl -fsS http://127.0.0.1:5600/api/health
# -> 200 {"ok":true,...,"pool":{...}}
```

Instalar el watchdog (auto-recuperación del "pegado"), en el cron de `prodapp`:

```bash
chmod +x /home/prodapp/visor-productividad/deploy/healthcheck.sh
crontab -e
# * * * * * /home/prodapp/visor-productividad/deploy/healthcheck.sh >> /home/prodapp/vp-healthcheck.log 2>&1
```

Opcional — adoptar `ecosystem.config.js` (solo agrega `max_memory_restart`). Como el
proceso ya corre sin ecosystem, primero hay que borrarlo para no duplicarlo:

```bash
pm2 delete visor-productividad
pm2 start /home/prodapp/visor-productividad/deploy/ecosystem.config.js
pm2 save
```

Nota: el runbook de la sección 5 usa rutas `/opt/...` y **systemd** como ejemplo
genérico; la operación real de este server es **PM2** en `/home/prodapp`. Si operas
con PM2, usá esta sección (no mezcles ambos supervisores sobre el mismo proceso).
