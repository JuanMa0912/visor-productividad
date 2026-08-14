# Timer correo diario rotación

Envía cada mañana:

1. **Correo individual por sede** (activo) → solo el digest de esa sede al
   correo del mapa en `email-pilot-sedes.ts`.
2. **Correo consolidado** (todas las sedes) →
   **`aprendizppt@mercamio.com`** (override con `ROTACION_EMAIL_FORCE_TO`).

### Mapa actual (cuaderno 2026-08-03)

| Sede | Destinatario |
| --- | --- |
| Calle 5ta (5ta) | administradorsta@mercamio.com |
| La 39 (39) | administrador39@mercamio.com |
| Plaza Norte | j.cardozo@mercamio.com |
| Ciudad Jardin | admjardin@mercamio.com |
| Palmira | subadministrador-pm@mercamio.com |
| Floresta | admon.floresta@mercamio.com |
| Floralia | admon.floralia@mercamio.com |
| Guaduales | c.lopez@mercamio.com |
| Bogota | administradorcl80@mercamio.com |
| Chia | administradorchia@mercamio.com |

Sin destinatario aún: **Centro Sur**, **Dinastía 1**, **Dinastía 2** (se omiten).

Incluye **puntuación restock 0–100**: % de ítems marcados `surtido` en contexto
restock **dentro del rango del correo** que luego tuvieron venta (misma sede)
hasta el fin del rango. Si no hubo marcas a surtido en el periodo, el score es
**0** (no “vacío”). Solo se muestra “—” si faltan tablas de auditoría/ventas.
En el consolidado, el score de cadena agrega marcas y ventas de todas las sedes.

El runbook general está en [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

## Contenido del correo individual

Por sede, con la misma lógica que `/rotacion` filtrada a **Manufactura**
(resto de líneas N1; **perecederos omitidos por ahora**):

1. **Resumen Manufactura D+0+S** — productos, inventario y **días de inventario**
   (cobertura de ítems Demanda D, ABCD solo entre manufactura).
2. **Bloque Manufactura** en 3 columnas (D | 0 | S).

Los conteos **0** y **S** no dependen del ABCD; **D** sí. Las cifras deben
cuadrar con la UI al filtrar familia Manufactura.

| Columna / métrica | Contenido |
| --- | --- |
| **Resumen / cabecera** | productos + inventario + días de inventario (Demanda) |
| **D · Demanda** | ítems, inventario, días de inventario |
| **0 · Cero** / **S · Restock** | ítems + Sin ver / Seg / Surt (%) |

## Contenido del correo consolidado (todas las sedes)

Asunto: `Rotación · Todas las sedes · Críticos D+0+S · {rango}`.

Pensado para que gerencia vea si cada sede “funciona” y qué mejorar:

1. **Cómo leer** — guía corta (restock, tamaño del crítico, gestión).
2. **Total cadena** — productos + inventario D+0+S + restock agregado.
3. **Comparativo** — Restock · Productos · Inventario · D · 0 · S (mismas cifras del individual).
4. **Gestión** — Sin ver (ceros) · % surtido 0 · % surtido S · DI Demanda · **Foco** (alertas: restock bajo, ceros sin verificar, poco surtido, DI alto).
5. **Por familia** — Perecederos / Manufactura.

Las sedes salen del catálogo de rotación del rango por defecto. Sedes sin
destinatario en el mapa individual igual entran al consolidado.

## Variables

| Variable | Uso |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | servidor SMTP |
| `SMTP_FROM` | remitente (opcional; default `SMTP_USER`) |
| `ROTACION_EMAIL_FLORESTA_TO` | legacy; el envío piloto fuerza `ROTACION_EMAIL_FORCE_TO` o `aprendizppt@mercamio.com` |
| `ROTACION_EMAIL_FORCE_TO` | destinatario único (default `aprendizppt@mercamio.com`) |
| `ROTACION_EMAIL_DRY_RUN` | `true` imprime en consola sin enviar |
| `ROTACION_EMAIL_SKIP_INDIVIDUAL` | `true` omite correos por sede |
| `ROTACION_EMAIL_FORCE_INDIVIDUAL_TO` | redirige todos los individuales a un solo correo (pruebas) |
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
# Solo consolidado a aprendiz (sin individuales)
sudo -u visor bash -c 'cd /opt/visor-productividad && ROTACION_EMAIL_SKIP_INDIVIDUAL=true ENV_FILE=/opt/visor-productividad/.env.local npm run rotacion:email'

# Probar individuales redirigidos a aprendiz (sin spamear sedes)
sudo -u visor bash -c 'cd /opt/visor-productividad && ROTACION_EMAIL_SKIP_CONSOLIDATED=true ROTACION_EMAIL_FORCE_INDIVIDUAL_TO=aprendizppt@mercamio.com ENV_FILE=/opt/visor-productividad/.env.local npm run rotacion:email'
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
