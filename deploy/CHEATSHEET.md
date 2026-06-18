# Cheat Sheet — Visor Productividad

Comandos de uso diario para operar la app en GCP.

> Convención: **VM** = SSH al `app-server`. **Cloud Shell** = terminal del navegador en GCP. **PowerShell** = tu PC local.

---

## 1. Conectar

**SSH al VM** (desde Cloud Shell):
```bash
gcloud compute ssh app-server --zone=us-east1-d
```

**Entrar a la BD** (desde el VM):
```bash
sudo bash -c 'set -a; source /opt/visor-productividad/.env.local; set +a; PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require psql --host="$DB_HOST" --port="${DB_PORT:-5432}" --username="$DB_USER" --dbname="$DB_NAME"'
```

Salir de psql: `\q`

---

## 2. App (servicio `visor`)

```bash
sudo systemctl status visor --no-pager     # estado
sudo systemctl restart visor               # reiniciar
sudo systemctl stop visor                  # parar
sudo systemctl start visor                 # prender
sudo journalctl -u visor -f                # logs en vivo (Ctrl+C para salir)
sudo journalctl -u visor -n 100 --no-pager # últimas 100 líneas
```

---

## 3. Deploy (subir cambios)

**PowerShell** (tu PC):
```powershell
cd c:\Users\juanf\OneDrive\Documentos\Colaborador\visor-productividad-colab
git add .
git commit -m "tu mensaje"
git push origin main
```

**VM**:
```bash
cd /opt/visor-productividad
sudo -u visor git pull origin main
sudo -u visor npm run build:server   # incluye copia de static/ y public/ al standalone
sudo systemctl restart visor
sudo systemctl status visor --no-pager
```

> Si ves `ChunkLoadError` o chunks 404 tras un deploy: casi siempre falto
> `npm run build:server` completo o se reinicio el servicio antes de que
> terminara el build. No uses Ctrl+Z durante el build.

**Logos rotos en login (`mercamio.jpeg` / `mercatodo.jpeg`):**
- Archivos en `public/logos/` (versionados en git).
- Deben copiarse a `.next/standalone/public/logos/` (lo hace `build:server`).
- Tras rebuild: `sudo systemctl restart visor`.
- Verificar: `curl -sI http://127.0.0.1:3000/logos/mercamio.jpeg` → `200` (no `302` a `/login`).
- El proxy (`src/proxy.ts`) debe dejar pasar `/logos/` sin cookie de sesión.
- El build standalone usa `<img>` directo y `images.unoptimized` (sin `/_next/image`).

---

## 4. Rollback (revertir deploy malo)

**VM**:
```bash
cd /opt/visor-productividad
sudo -u visor git log --oneline -5                     # 1. busca el HASH bueno
sudo -u visor git reset --hard HASH                    # 2. retrocede
sudo -u visor npm run build:server                     # 3. rebuild (+ copia assets)
sudo systemctl restart visor
```

---

## 5. Base de datos (en psql)

**Ver queries activas:**
```sql
SELECT pid, usename, state, wait_event,
       EXTRACT(EPOCH FROM (now() - query_start))::int AS segundos,
       LEFT(regexp_replace(query, '\s+', ' ', 'g'), 100) AS query
FROM pg_stat_activity
WHERE state = 'active' AND pid != pg_backend_pid()
ORDER BY segundos DESC;
```

**Cancelar / matar query:**
```sql
SELECT pg_cancel_backend(PID);      -- pide cancelar (graceful)
SELECT pg_terminate_backend(PID);   -- mata la sesión (forceful)
```

**Top 10 queries más lentas:**
```sql
SELECT LEFT(regexp_replace(query, '\s+', ' ', 'g'), 100) AS query,
       calls,
       ROUND(total_exec_time::numeric/1000, 1) AS total_seg,
       ROUND(mean_exec_time::numeric, 0) AS mean_ms
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_catalog%'
ORDER BY total_exec_time DESC LIMIT 10;
```

**Resetear stats** (para empezar a medir limpio):
```sql
SELECT pg_stat_statements_reset();
```

---

## 6. Nginx

```bash
sudo nginx -t                       # valida config
sudo systemctl reload nginx         # recarga sin tirar conexiones
sudo systemctl restart nginx        # reinicia (corta conexiones)
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

---

## 7. Infra GCP (desde Cloud Shell, NO desde el VM)

**VM:**
```bash
gcloud compute instances list
gcloud compute instances stop  app-server --zone=us-east1-d     # apagar (ahorrar plata)
gcloud compute instances start app-server --zone=us-east1-d     # prender
```

**Cloud SQL:**
```bash
gcloud sql instances list
gcloud sql instances restart db-service                          # reinicia (~30-60s downtime)
gcloud sql instances patch  db-service --activation-policy=NEVER  # apagar
gcloud sql instances patch  db-service --activation-policy=ALWAYS # prender
```

**Load Balancer:**
```bash
gcloud compute backend-services list
gcloud compute backend-services update charis-back --global --timeout=90
```

---

## 8. Cleanup-logs (mantenimiento BD semanal)

```bash
# Correr manualmente ahora (sin esperar al domingo)
sudo systemctl start visor-cleanup-logs.service

# Probar en seco (no borra, solo cuenta)
sudo -u visor /opt/visor-productividad/scripts/cleanup-logs.sh --dry-run

# Ver cuándo corrió y cuándo viene
systemctl list-timers visor-cleanup-logs.timer --no-pager

# Historial
sudo tail -n 50 /var/log/visor-cleanup.log
```

---

## 9. Diagnóstico rápido

**¿La app está viva?**
```bash
sudo systemctl is-active visor
curl -I http://localhost:3000
```

**¿Llego a la BD desde el VM?**
```bash
nc -zv $(sudo grep DB_HOST /opt/visor-productividad/.env.local | cut -d= -f2) 5432
```

**Recursos del VM:**
```bash
df -h                          # disco
free -h                        # RAM
top -bn1 | head -20            # CPU + procesos
du -sh /opt/visor-productividad/.next/   # tamaño del build
```

---

## 10. Rotación — optimización CPU + cache cliente (2026-06)

GCP reportó saturación de CPU por queries con `TRIM`/`COALESCE` sobre millones de
filas en `rotacion_base_item_dia_sede`. La solución tiene **tres capas**:

| Capa | Qué hace | Dónde vive |
|------|----------|------------|
| **1. Matview BD** | Pre-limpia strings, filtra categorías/sedes, agrega por día | `rotacion_item_dia_clean` en Cloud SQL |
| **2. API** | Lee matview con fallback a tabla cruda; cache HTTP 5 min | `/api/rotacion` |
| **3. Cache cliente** | IndexedDB keyed por sede+fechas+filtros; TTL 5 min | Browser (`rotacion-rows-idb-cache.ts`) |

### Resultados medidos en producción (jun 2026)

| Escenario | Antes (raw) | Después |
|-----------|-------------|---------|
| 1ª carga sede (30 días, ~22k filas) | ~20–35 s | **~10–11 s** (matview) |
| SQL por sede (logs servidor) | ~20–35 s | **~9–11 s** |
| F5 / volver a misma sede (&lt;5 min) | ~11 s (re-fetch) | **~0.1–0.5 s** (IndexedDB) |
| Cambio Floresta → Floralia | ~11 s | ~9–11 s (fetch nuevo, correcto) |
| Volver a Floresta | ~11 s | **~73 ms** en red (sin request de 15 MB) |

Header esperado en Network (request de datos):

| Header | Valor |
|--------|-------|
| `X-Data-Source` | `matview` |
| `Cache-Control` | `private, max-age=300, stale-while-revalidate=900` |

### Por qué `no-store` en fetch + IndexedDB (no mezcla sedes)

El frontend usa `cache: "no-store"` en los fetch para evitar que el browser HTTP
sirva datos de **otra sede** tras F5 (ej. filtrar Floresta, recargar, elegir
Floralia). El cache HTTP del API **no se usa en el browser** por eso.

En su lugar, IndexedDB guarda filas con clave:

```
/api/rotacion|{fechas}|{empresas}|{sedeIds}|{lineasN1}|{categorias}
```

Floresta y Floralia tienen **claves distintas** → no se mezclan. Máximo 6
entradas en IDB (~15 MB c/u); las más viejas se evictan si falta espacio.

**Logs en consola del browser (F12):**

```
[rotacion] Tabla cargada en 10.9s          ← 1ª carga (miss)
[rotacion] Cache IDB guardado (21885 filas, TTL 5 min).
[rotacion] Cache IDB hit en 0.2s (150 ms). ← F5 misma sede (hit)
```

En **hit**, Network no muestra request `rotacion` de ~15 MB; solo catálogo
(`catalogOnly`, ~3 kB) y `cero-estados`.

### Vista materializada en BD (`rotacion_item_dia_clean`)

- Migración: `db/migrations/20260616_rotacion_clean_matview.sql`
- Refresh diario: `visor-refresh-rotacion.timer` (06:15 UTC)
- Script manual: `scripts/refresh-rotacion-matview.sh`

**Aplicar migración (una vez; ~3–8 min, pico de CPU en Cloud SQL):**

```bash
cd /opt/visor-productividad
sudo -u visor git pull origin main

sudo -u visor bash -c '
  set -a
  source /opt/visor-productividad/.env.local
  set +a
  export PGPASSWORD="$DB_PASSWORD"
  export PGSSLMODE=require
  psql \
    --host="$DB_HOST" \
    --port="${DB_PORT:-5432}" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --set ON_ERROR_STOP=on \
    -f /opt/visor-productividad/db/migrations/20260616_rotacion_clean_matview.sql
'

# Verificar
sudo -u visor bash -c '
  set -a; source /opt/visor-productividad/.env.local; set +a
  export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
  psql --host="$DB_HOST" --port="${DB_PORT:-5432}" --username="$DB_USER" --dbname="$DB_NAME" \
    -c "SELECT COUNT(*) AS filas, MIN(fecha) AS desde, MAX(fecha) AS hasta FROM rotacion_item_dia_clean;"
'
```

> Si la matview ya existe (query anterior devuelve filas), **no** re-correr la
> migración salvo que falten índices.

### Timer de refresh diario (06:15 UTC)

```bash
sudo cp /opt/visor-productividad/deploy/systemd/visor-refresh-rotacion.service /etc/systemd/system/
sudo cp /opt/visor-productividad/deploy/systemd/visor-refresh-rotacion.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now visor-refresh-rotacion.timer
systemctl list-timers visor-refresh-rotacion.timer --no-pager
```

Refresh manual:

```bash
sudo systemctl start visor-refresh-rotacion.service
sudo journalctl -u visor-refresh-rotacion -n 30 --no-pager
```

### Deploy código rotación + cache IDB

```bash
cd /opt/visor-productividad
sudo -u visor git pull origin main
# Si git pull falla por cherry-pick a medias:
#   sudo -u visor git cherry-pick --abort
#   sudo -u visor git pull origin main

sudo -u visor npm run build:server    # esperar "[copy-standalone-assets] OK"
sudo systemctl restart visor
```

### Validar en producción

**Browser (incógnito o caché limpio):**

1. Cargar sede A → ~11 s; consola: `Tabla cargada` + `Cache IDB guardado`.
2. F5 sin cambiar filtros → consola: `Cache IDB hit`; Network sin request ~15 MB.
3. Cambiar a sede B → ~11 s (miss).
4. Volver a sede A → hit rápido.

**Servidor (VM):**

```bash
# Logs en vivo mientras cargás rotación
sudo journalctl -u visor -f | grep -E "rotacion API"

# En hit de IDB NO debe aparecer nueva línea "iniciando fetch"
# En miss (1ª carga sede):
#   [rotacion API matview] sql empresa=... sede=... duration=10.5s
#   [rotacion API] fetch completo en 10.58s (... source=matview)

# Resumen última hora
sudo journalctl -u visor --since "1 hour ago" --no-pager \
  | grep -E "rotacion API.*(fetch completo|matview|iniciando)"
```

**Admin — EXPLAIN de una sede (sin traer 15 MB):**

```
https://uaid.mercamio.com.co/api/rotacion?explain=1&start=YYYY-MM-DD&end=YYYY-MM-DD&empresa=...&sede=...
```

**Variante SQL matview (default `ranked`, alternativa `hashagg`):**

| Mecanismo | Uso |
|-----------|-----|
| Default código | `ranked` (window functions, ~10–11 s) |
| Env en VM | `ROTACION_MATVIEW_SQL=hashagg` en unit systemd de `visor` |
| Admin A/B | `?matviewSql=hashagg` o `?matviewSql=ranked` con `explain=1` |
| Header respuesta | `X-Matview-Sql: ranked` o `hashagg` |

Rollback rápido a la variante experimental sin redeploy de git:

```bash
# En /etc/systemd/system/visor.service.d/override.conf o Environment=
ROTACION_MATVIEW_SQL=hashagg
sudo systemctl daemon-reload && sudo systemctl restart visor
```

Quitar la variable (o `=ranked`) vuelve al default del código.

### Troubleshooting rotación

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| `ChunkLoadError` / chunks 404 | Build incompleto o assets no copiados | `npm run build:server` completo; verificar 61 chunks en `.next/standalone/.next/static/chunks/` |
| `X-Data-Source: raw` | Matview no existe en BD | Aplicar migración o refresh timer |
| F5 sigue ~11 s, sin `Cache IDB hit` | IDB no guardó (quota) o filtros distintos | Consola: buscar `Cache IDB escritura fallida`; esperar `guardado` antes de F5 |
| Floresta muestra datos de otra sede | No debería pasar con IDB | Reportar; clave incluye `sedeIds` |
| API 404 en todo | Servicio caído o durante restart | `curl http://127.0.0.1:3000/api/auth/me` → debe ser 401 |
| `git pull` bloqueado | Cherry-pick a medias | `sudo -u visor git cherry-pick --abort` luego pull |

### Rollback solo de código (matview en BD se queda)

```bash
cd /opt/visor-productividad
sudo -u visor git reset --hard f176fbf   # antes de matview en endpoint
sudo -u visor npm run build:server
sudo systemctl restart visor
```

### Archivos relevantes en el repo

| Archivo | Rol |
|---------|-----|
| `db/migrations/20260616_rotacion_clean_matview.sql` | Crea matview + índices |
| `scripts/refresh-rotacion-matview.sh` | REFRESH CONCURRENTLY |
| `src/app/api/rotacion/route.ts` | Endpoint matview + fallback raw |
| `src/app/rotacion/rotacion-rows-idb-cache.ts` | Cache IndexedDB cliente |
| `src/app/rotacion/page.tsx` | Integración cache en `reloadRotacionRows` |
| `scripts/copy-standalone-assets.mjs` | Copia chunks al standalone post-build |

---
## Reglas importantes

- `gcloud sql ...` y `gcloud compute ...` **solo desde Cloud Shell**, no desde el VM (la VM no tiene permisos).
- No hagas `git push --force` a `main`.
- Después de editar archivos en `/etc/systemd/system/`, siempre `sudo systemctl daemon-reload`.
- No reinicies `visor` mientras corre `visor-cleanup-logs.service` (espera 1-2 min a que termine).

---

## 11. Seguridad de la app (auditoría 2026-06-11)

**Controles ya implementados:**
- Rate limiting: 10 intentos/IP, 5/usuario en 15min.
- bcrypt cost 12, hash precalculado dummy para evitar timing-attack de username enumeration.
- Sleep artificial de 250ms en cada login fallido (anti-brute-force).
- Password: mínimo 8 caracteres, máximo 72 bytes (límite de bcrypt).
- CSRF tokens en logout, change-password, admin/users.
- Session tokens hasheados sha256 en BD.
- Headers: CSP, HSTS, X-Frame DENY, COOP, COEP, Permissions-Policy.

**Flag peligrosa a vigilar:** `EXCEL_DIAN_EXPORT_PUBLIC`. Si la pones en `true` en producción, expone `/api/excel-dian/export` SIN auth (acceso a 3 bases DIAN externas). Si se activa, sale un `[SECURITY]` loud en logs al startup.

**Verificar warnings de seguridad al arrancar:**
```bash
sudo journalctl -u visor --since "10 minutes ago" | grep -i "\[security\]"
```

**Mejoras pendientes (no implementadas todavía):**
- Política de password más estricta (rechazar passwords comunes, no permitir username=password).
- Persistir failed-login attempts en BD para auditoría (hoy solo viven en memoria del proceso).
- Migrar credenciales de `.env.local` a GCP Secret Manager (requiere aprobación del admin para costos, aunque sería $0 en free tier).
- 2FA / MFA en login (scope grande).
- Restringir SSH al VM a IPs específicas (firewall GCP).
- Limpiar registro DNS AAAA (IPv6) apuntando a Hostinger.
