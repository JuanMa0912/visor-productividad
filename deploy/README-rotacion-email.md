# Timer correo diario rotación

Envía cada mañana un resumen de **Críticos · D+0+S** por sede piloto
(actualmente Floresta).

El runbook general está en [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

## Contenido del correo

Por sede, con la misma lógica que `/rotacion`, en **un solo correo** con dos bloques:

1. **Resumen total sede** (D+0+S agregado).
2. **Perecederos** (líneas N1 01, 02, 03, 04, 12): total, D, 0 y S.
3. **Manufactura** (resto de líneas N1): total, D, 0 y S.

Cada bloque incluye:

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

**Mercamio (Zimbra):** según sistemas, **SMTP `3465`** e **IMAP `3993`**
(solo referencia). Envío programático:

```env
SMTP_HOST=smtp.mercamio.com
SMTP_PORT=3465
```

Webmail: `correo.mercamio.com`. El puerto **3465** usa **SMTPS** (TLS directo,
como `465`); no usar `587` salvo que sistemas indique lo contrario. **IMAP
3993** es solo lectura de buzón, no aplica al envío.
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

Prueba manual (como usuario `visor`, que es dueño de `.env.local`):

```bash
sudo -u visor ENV_FILE=/opt/visor-productividad/.env.local \
  /opt/visor-productividad/scripts/rotacion-daily-email.sh
```

Probe SMTP sin enviar correo:

```bash
cd /opt/visor-productividad
sudo -u visor npm run smtp:probe
```

Si corres como otro usuario (`juanfelipegomez0105`, etc.) verás `EACCES` al leer
`.env.local`; es intencional (el archivo tiene permisos restrictivos).

Antes del primer envío, agrega en `/opt/visor-productividad/.env.local` (como
`visor` o root):

```env
SMTP_HOST=smtp.mercamio.com
SMTP_PORT=3465
SMTP_USER=notificaciones.uaid@mercamio.com
SMTP_PASSWORD='...'
SMTP_FROM="Notificaciones UAID <notificaciones.uaid@mercamio.com>"
ROTACION_EMAIL_FLORESTA_TO=aprendizppt@mercamio.com
SMTP_TLS_REJECT_UNAUTHORIZED=false
```

Prueba de envío:

```bash
sudo -u visor bash -c 'cd /opt/visor-productividad && ROTACION_EMAIL_SMTP_TEST_ONLY=true npm run rotacion:email'
```

Activar timer:

```bash
sudo systemctl enable --now visor-rotacion-email.timer
systemctl list-timers visor-rotacion-email.timer
```
