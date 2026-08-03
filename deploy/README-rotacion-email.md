# Timer correo diario rotación

Envía cada mañana:

1. **Correo consolidado** (activo) con **todas las sedes** del catálogo de
   rotación, en tablas comparativas ordenadas como en el portal →
   **`aprendizppt@mercamio.com`** (override con `ROTACION_EMAIL_FORCE_TO`).
2. **Correos individuales por sede** — **desactivados** hasta configurar
   destinatarios reales (`ROTACION_EMAIL_SEND_INDIVIDUAL=true` para opt-in).

Incluye **puntuación restock 0–100**: % de ítems marcados `surtido` en contexto
restock **dentro del rango del correo** que luego tuvieron venta (misma sede)
hasta el fin del rango. En el consolidado, el score de cadena agrega marcas y
ventas de todas las sedes.

El runbook general está en [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

## Contenido del correo individual

Por sede, con la misma lógica que `/rotacion`, en **un solo correo** con dos bloques:

1. **Resumen total sede** (D+0+S agregado, ABCD calculado sobre **todo** el catálogo de la sede — como la UI sin filtro de familia).
2. **Perecederos** (líneas N1 01, 02, 03, 04, 12): total, D, 0 y S (ABCD **solo** entre perecederos — como filtrar familia Perecederos en la UI).
3. **Manufactura** (resto de líneas N1): total, D, 0 y S (ABCD **solo** entre manufactura — como filtrar familia Manufactura en la UI).

Los conteos **0** y **S** no dependen del ABCD; **D** sí cambia al filtrar familia. Por eso el total sede puede no coincidir con la suma de D de cada bloque, aunque D+0+S por bloque sí debe cuadrar con la UI al aplicar el mismo filtro de familia.

Cada bloque se muestra en **3 columnas** (D | 0 | S) para leer rápido:

| Columna | Contenido |
| --- | --- |
| **Total D+0+S** (cabecera de familia) | productos + inventario |
| **D · Demanda** | ítems, inventario, días de inventario |
| **0 · Cero** / **S · Restock** | ítems + Sin ver / Seg / Surt (%) |

## Contenido del correo consolidado (todas las sedes)

Asunto: `Rotación · Todas las sedes · Críticos D+0+S · {rango}`.

1. **Total cadena**: suma de productos e inventario D+0+S + restock agregado.
2. **Comparativo por sede** (orden `SEDE_ORDER`): Restock · Productos · Inventario (rojo) · D · 0 · S.
3. **Desglose por familia**: Perecederos / Manufactura (conteo e inventario).

Las sedes salen del catálogo de rotación del rango por defecto (mismo rolling
month que los individuales). Si el catálogo falla, se usa solo la lista piloto.

## Variables

| Variable | Uso |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | servidor SMTP |
| `SMTP_FROM` | remitente (opcional; default `SMTP_USER`) |
| `ROTACION_EMAIL_FLORESTA_TO` | legacy; el envío piloto fuerza `ROTACION_EMAIL_FORCE_TO` o `aprendizppt@mercamio.com` |
| `ROTACION_EMAIL_FORCE_TO` | destinatario único (default `aprendizppt@mercamio.com`) |
| `ROTACION_EMAIL_DRY_RUN` | `true` imprime en consola sin enviar |
| `ROTACION_EMAIL_SEND_INDIVIDUAL` | `true` activa correos por sede (OFF por defecto) |
| `ROTACION_EMAIL_SKIP_CONSOLIDATED` | `true` omite el correo de todas las sedes |
| `ENV_FILE` | default `/opt/visor-productividad/.env.local` |
| `LOG_FILE` | default `/var/log/visor-rotacion-email.log` |

**Mercamio (Zimbra):** SMTP **`3465`** (SMTPS) · IMAP **`3993`** (solo lectura).
Webmail: `correo.mercamio.com`. No usar `587` salvo indicación de sistemas.

```env
SMTP_HOST=smtp.mercamio.com
SMTP_PORT=3465
```

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
# Vista previa del consolidado (sin SMTP; individuales off por defecto)
ROTACION_EMAIL_DRY_RUN=true npm run rotacion:email
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
ROTACION_EMAIL_FLORESTA_TO=aprendizppt@mercamio.com,alexander@mercamio.com
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
