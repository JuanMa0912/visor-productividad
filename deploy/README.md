# Limpieza semanal de logs (cleanup-logs)

Borra automaticamente los registros antiguos de las tablas de auditoria/sesion
para que no crezcan sin limite.

## Que borra

Cada ejecucion borra de la base de datos `produxdia` (Cloud SQL):

| Tabla                     | Condicion                                           |
| ------------------------- | --------------------------------------------------- |
| `app_user_activity_log`   | `observed_at < NOW() - INTERVAL '7 days'`           |
| `app_user_login_logs`     | `logged_at  < NOW() - INTERVAL '7 days'`            |
| `app_user_sessions`       | `expires_at < NOW() OR created_at < 7 dias atras`   |

Luego ejecuta `VACUUM (ANALYZE)` en las tres tablas para liberar espacio.

La ventana de retencion (`RETENTION_DAYS`) es configurable por variable de
entorno; por defecto 7 dias.

## Cuando corre

Un systemd timer dispara la tarea **todos los domingos a las 03:00** hora del
sistema. Si la VM estaba apagada en ese momento, `Persistent=true` hace que
se ejecute al siguiente arranque.

## Archivos

- `scripts/cleanup-logs.sh` - el script bash que ejecuta los DELETEs.
- `deploy/systemd/visor-cleanup-logs.service` - unidad oneshot que lanza el script.
- `deploy/systemd/visor-cleanup-logs.timer` - schedule semanal.

## Despliegue en la VM (una sola vez)

> Ejecutar como un usuario con `sudo` en `app-server` (Debian 12).

```bash
# 1) Traer los archivos del repo
cd /opt/visor-productividad
sudo -u visor git pull

# 2) Permisos al script
sudo chmod +x /opt/visor-productividad/scripts/cleanup-logs.sh

# 3) Archivo de log persistente
sudo touch /var/log/visor-cleanup.log
sudo chown visor:visor /var/log/visor-cleanup.log

# 4) Instalar las unidades de systemd
sudo cp /opt/visor-productividad/deploy/systemd/visor-cleanup-logs.service /etc/systemd/system/
sudo cp /opt/visor-productividad/deploy/systemd/visor-cleanup-logs.timer   /etc/systemd/system/
sudo systemctl daemon-reload

# 5) Probar en seco (no borra nada)
sudo -u visor /opt/visor-productividad/scripts/cleanup-logs.sh --dry-run

# 6) Si el dry-run se ve bien, activar el timer
sudo systemctl enable --now visor-cleanup-logs.timer

# 7) Verificar que esta agendado
systemctl list-timers visor-cleanup-logs.timer
```

## Operacion

```bash
# Ver cuando corrio por ultima vez y cuando corre la proxima
systemctl list-timers visor-cleanup-logs.timer

# Ver el log historico
sudo tail -n 50 /var/log/visor-cleanup.log

# Ver el journal de la ultima ejecucion
journalctl -u visor-cleanup-logs.service -n 100 --no-pager

# Ejecutar manualmente ahora (sin esperar al domingo)
sudo systemctl start visor-cleanup-logs.service

# Pausar temporalmente la limpieza
sudo systemctl disable --now visor-cleanup-logs.timer
```

## Cambiar la retencion

Editar la unidad service para pasar la variable:

```ini
[Service]
Environment=RETENTION_DAYS=14
```

Y luego `sudo systemctl daemon-reload`.
