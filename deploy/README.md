# Timer cleanup-logs

Instala y opera la limpieza semanal de logs y sesiones del visor.

El runbook general de despliegue Linux esta en
[`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

## Que limpia

`scripts/cleanup-logs.sh` borra registros antiguos de:

| Tabla | Condicion |
| --- | --- |
| `app_user_activity_log` | `observed_at < NOW() - INTERVAL '<RETENTION_DAYS> days'` |
| `app_user_login_logs` | `logged_at < NOW() - INTERVAL '<RETENTION_DAYS> days'` |
| `app_user_sessions` | `expires_at < NOW()` o `created_at` anterior a la retencion |
| `app_user_login_attempt_log` | `logged_at` con `AUDIT_RETENTION_DAYS` (default 90) |
| `app_user_admin_audit` | `created_at` con `AUDIT_RETENTION_DAYS` (default 90) |
| `app_export_download_log` | `created_at` con `DOWNLOAD_RETENTION_DAYS` (default 274 ~ 9 meses) |

Despues ejecuta `VACUUM (ANALYZE)` sobre esas tablas, excepto en `--dry-run`.

## Variables

| Variable | Default | Uso |
| --- | --- | --- |
| `RETENTION_DAYS` | `7` | ventana de retencion actividad/login/sesiones |
| `AUDIT_RETENTION_DAYS` | `90` | retencion auditoria admin + fallos login |
| `DOWNLOAD_RETENTION_DAYS` | `274` | retencion bitacora de descargas (~9 meses) |
| `ENV_FILE` | `/opt/visor-productividad/.env.local` | archivo con credenciales DB |
| `LOG_FILE` | `/var/log/visor-cleanup.log` | log persistente adicional al journal |
| `DB_SSL` | `false` | si es `true`, usa `PGSSLMODE=require` |

El script requiere `DB_HOST`, `DB_NAME`, `DB_USER` y `DB_PASSWORD` en
`ENV_FILE`. Usa `DB_PORT` si existe, si no `5432`.

## Archivos

| Archivo | Uso |
| --- | --- |
| `scripts/cleanup-logs.sh` | script ejecutable |
| `deploy/systemd/visor-cleanup-logs.service` | unidad oneshot |
| `deploy/systemd/visor-cleanup-logs.timer` | schedule semanal, domingos 03:00 |

## Instalacion

Ejecutar en la VM como un usuario con `sudo`.

```bash
cd /opt/visor-productividad
sudo -u visor git pull

sudo chmod +x /opt/visor-productividad/scripts/cleanup-logs.sh

sudo touch /var/log/visor-cleanup.log
sudo chown visor:visor /var/log/visor-cleanup.log

sudo cp /opt/visor-productividad/deploy/systemd/visor-cleanup-logs.service /etc/systemd/system/
sudo cp /opt/visor-productividad/deploy/systemd/visor-cleanup-logs.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

## Probar antes de activar

```bash
sudo -u visor /opt/visor-productividad/scripts/cleanup-logs.sh --dry-run
```

Con otro archivo `.env`:

```bash
sudo -u visor ENV_FILE=/opt/visor-productividad/.env.production \
  /opt/visor-productividad/scripts/cleanup-logs.sh --dry-run
```

Con retencion distinta:

```bash
sudo -u visor RETENTION_DAYS=14 \
  /opt/visor-productividad/scripts/cleanup-logs.sh --dry-run
```

## Activar

```bash
sudo systemctl enable --now visor-cleanup-logs.timer
systemctl list-timers visor-cleanup-logs.timer
```

## Operacion

```bash
# Proxima y ultima ejecucion
systemctl list-timers visor-cleanup-logs.timer

# Log persistente
sudo tail -n 50 /var/log/visor-cleanup.log

# Journal de la unidad
journalctl -u visor-cleanup-logs.service -n 100 --no-pager

# Ejecutar ahora
sudo systemctl start visor-cleanup-logs.service

# Pausar
sudo systemctl disable --now visor-cleanup-logs.timer
```

## Cambiar retencion permanente

Editar la unidad o crear override:

```bash
sudo systemctl edit visor-cleanup-logs.service
```

Contenido:

```ini
[Service]
Environment=RETENTION_DAYS=14
```

Aplicar:

```bash
sudo systemctl daemon-reload
sudo systemctl restart visor-cleanup-logs.timer
```
