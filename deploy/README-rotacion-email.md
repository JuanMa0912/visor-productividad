# Timer correo diario rotación

Envía cada mañana un resumen de **Críticos · D+0+S** por sede piloto
(actualmente Floresta).

El runbook general está en [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

## Contenido del correo

Por sede, con la misma lógica que `/rotacion`:

| Bloque | Métricas |
| --- | --- |
| **Total D+0+S** | cantidad de productos + total inventario ($) |
| **D · Demanda** | ítems, total inventario, días de inventario |
| **0 · Cero rotación** | ítems, sin verificar, seguimiento, surtido (% surtidos) |
| **S · Restock** | ítems, sin verificar, seguimiento, surtido (% surtidos) |

## Variables

| Variable | Uso |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | servidor SMTP |
| `SMTP_FROM` | remitente (opcional; default `SMTP_USER`) |

**Mercamio (Zimbra):** `SMTP_HOST=smtp.mercamio.com` (webmail en
`correo.mercamio.com`), puerto `587`. Si `587` falla, probar `465` con
`SMTP_PORT=465`. La contraseña con `#` o `=` debe ir entre comillas en
`.env.local`.
| `ROTACION_EMAIL_FLORESTA_TO` | destinatarios Floresta, separados por coma |
| `ROTACION_EMAIL_DRY_RUN` | `true` imprime en consola sin enviar |
| `ENV_FILE` | default `/opt/visor-productividad/.env.local` |
| `LOG_FILE` | default `/var/log/visor-rotacion-email.log` |

Requiere credenciales de BD (`DB_*`) en `ENV_FILE`.

## Archivos

| Archivo | Uso |
| --- | --- |
| `scripts/rotacion-daily-email.mts` | lógica de envío |
| `scripts/rotacion-daily-email.sh` | wrapper con log |
| `deploy/systemd/visor-rotacion-email.service` | unidad oneshot |
| `deploy/systemd/visor-rotacion-email.timer` | schedule diario 08:00 hora local |

La VM debe tener zona horaria `America/Bogota` (o ajustar `OnCalendar` del timer).

## Probar en local

```bash
# Solo vista previa (sin SMTP)
ROTACION_EMAIL_DRY_RUN=true \
ROTACION_EMAIL_FLORESTA_TO=tu@correo.com \
npm run rotacion:email
```

## Instalación en VM

```bash
cd /opt/visor-productividad
sudo -u visor git pull
npm ci
sudo chmod +x /opt/visor-productividad/scripts/rotacion-daily-email.sh

sudo touch /var/log/visor-rotacion-email.log
sudo chown visor:visor /var/log/visor-rotacion-email.log

sudo cp deploy/systemd/visor-rotacion-email.service /etc/systemd/system/
sudo cp deploy/systemd/visor-rotacion-email.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

Prueba manual:

```bash
sudo -u visor ROTACION_EMAIL_DRY_RUN=true \
  /opt/visor-productividad/scripts/rotacion-daily-email.sh
tail -n 80 /var/log/visor-rotacion-email.log
```

Activar timer:

```bash
sudo systemctl enable --now visor-rotacion-email.timer
systemctl list-timers visor-rotacion-email.timer
```
