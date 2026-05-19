# Base de datos — Visor de Productividad

Referencia de tablas, índices y operación PostgreSQL usados por la aplicación. Para el orden de migraciones y scripts SQL, ver también [`STRUCTURE.md`](STRUCTURE.md). Para módulos y APIs, [`README.md`](../README.md).

---

## 1. Conexión y entorno

| Variable | Uso |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Pool principal (`src/lib/db/index.ts`) |
| `DB_SCHEMA` | Schema por defecto (`public`) |
| `AUDIT_IP_HMAC_SECRET` | Si está definido, login guarda IP como `hmac:…` en lugar de IP literal |
| `TRUST_PROXY=true` | Lee `x-forwarded-for` para IP de cliente (detrás de nginx/Cloudflare) |

**Usuario PostgreSQL operativo habitual:** `produ` (scripts en `db/crear-usuario.sql`, `db/permisos-usuario.sql`).

**Excel DIAN** usa bases **separadas** por empresa (`EXCEL_DIAN_MTDO_*`, `EXCEL_DIAN_MIO_*`, `EXCEL_DIAN_BGT_*`) — no comparten el mismo `DB_NAME` que el visor salvo que se configure igual a propósito.

---

## 2. Qué está en Git vs qué asume el servidor

```text
┌─────────────────────────────────────────────────────────────┐
│  En el repositorio (db/schema-auth.sql + db/migrations/)      │
│  Auth, horarios guardados, ventas x ítem, presets inventario, │
│  estados cero rotación, índices de rendimiento (parcial)      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Suele existir solo en el servidor (ETL / procesos externos) │
│  ventas_*, asistencia_horas, rotacion_base_item_dia_sede,     │
│  margenes_linea_co_dia, tablas DIAN (cmmovimiento_pdv, …)     │
└─────────────────────────────────────────────────────────────┘
```

La app **lee** las tablas de negocio; no incluye el DDL completo de `ventas_cajas` ni de `asistencia_horas` en migraciones. Si faltan columnas esperadas, los endpoints fallan o degradan (detección dinámica en rotación y asistencia).

---

## 3. Aplicar esquema (orden)

1. `db/schema-auth.sql`
2. Migraciones en `db/migrations/` por fecha (lista completa en [`STRUCTURE.md`](STRUCTURE.md#orden-de-migraciones-después-de-schema-autsql))

Verificar conectividad: `npm run db:test` o `npm run db:test:postgres`.

---

## 4. Dominios y tablas

### 4.1 Autenticación y administración

**Origen:** `db/schema-auth.sql` + migraciones `202602*` – `20260424`.

| Tabla | Descripción | Índices relevantes |
| --- | --- | --- |
| `app_users` | Usuarios del portal (`admin` / `user`), permisos por sede/línea/sección | PK `id`; **UNIQUE** `username` |
| `app_user_sessions` | Sesiones activas (`token_hash`, expiración) | `(user_id)`, `(expires_at)` |
| `app_user_login_logs` | Bitácora de login (`/admin/usuarios/accesos`) | `(user_id, logged_at DESC)` |

**Columnas habituales en `app_users`** (algunas vía migraciones):

| Columna | Tipo | Notas |
| --- | --- | --- |
| `username` | text | Login |
| `password_hash` | text | bcrypt |
| `role` | text | `admin` \| `user` |
| `sede` | text | Obligatoria si `role = user` |
| `allowed_sedes` | jsonb | `NULL` = todas |
| `allowed_lines` | text[] | Líneas de productividad |
| `allowed_dashboards` | text[] | Secciones UAID legacy (`venta`, `producto`, `operacion`) |
| `allowed_subdashboards` | text[] | Sub-secciones opcionales |
| `special_roles` | text[] | p. ej. `alex`, `cronograma` |
| `is_active` | boolean | |
| `last_login_at`, `last_login_ip` | timestamptz / inet | Actualizados en login |

**APIs:** `/api/auth/*`, `/api/admin/users`, `/api/admin/login-logs`.

---

### 4.2 Productividad y análisis por hora

**Origen:** tablas de negocio en servidor; índices en `20260516_productividad_x_linea_indexes.sql`.

| Tabla | Uso en la app |
| --- | --- |
| `ventas_cajas` | Línea Cajas |
| `ventas_fruver` | Fruver |
| `ventas_industria` | Industria |
| `ventas_carnes` | Carnes |
| `ventas_pollo_pesc` | Pollo / pescado |
| `ventas_asadero` | Asadero |
| `asistencia_horas` | Horas laboradas, marcaciones, análisis por hora, jornada extendida |

**Columnas usadas con frecuencia (ventas):** `fecha_dcto`, `centro_operacion`, `empresa_bd`, importes de venta (según línea).

**Columnas usadas con frecuencia (asistencia):** `fecha`, `sede`, `departamento`, `total_laborado_horas`, `hora_entrada`, `hora_intermedia1`, `hora_intermedia2`, `hora_salida`, `cargo`, `incidencia`, `nomina`; identificación de empleado vía columnas detectadas (`numero`, `cedula`, `documento`, … — ver `EMPLOYEE_ID_COLUMN_CANDIDATES` en `hourly-analysis/route.ts`).

**Índices (migración 20260516):**

| Índice | Tabla | Columnas |
| --- | --- | --- |
| `idx_ventas_*_prod_fecha_co_empresa` | Cada `ventas_*` | `(fecha_dcto, centro_operacion, empresa_bd)` |
| `idx_asistencia_horas_prod_fecha_sede_depto` | `asistencia_horas` | `(fecha, sede, departamento)` |

**APIs:** `/api/productivity`, `/api/hourly-analysis`, `/api/jornada-extendida/*`.

**Notas:**

- `GET /api/productivity` puede usar cache en archivo (`PRODUCTIVITY_CACHE_PATH`).
- Cédulas en lista de `src/lib/horarios/ocultar-cedulas.ts` no se muestran ni cuentan en análisis por hora para usuarios no admin (sí para admin).
- `asistencia_horas` no tiene DDL en el repo; en producción puede existir `ux_asistencia_numero_fecha` u otros índices locales no versionados aquí.

---

### 4.3 Márgenes

| Tabla | Uso |
| --- | --- |
| `margenes_linea_co_dia` | Agregados por línea, sede y día |

**API:** `/api/margenes`.  
**Regla de margen % agregado:** `SUM(margen) / SUM(ventas) * 100` (nunca promedio de porcentajes).

**Índices:** no hay migración en el repo; conviene alinear con filtros `(fecha, sede, linea)` si el volumen crece.

---

### 4.4 Rotación, inventario x ítem y kardex

| Tabla | Origen | Uso |
| --- | --- | --- |
| `rotacion_base_item_dia_sede` | Servidor (ETL) | Rotación (`/rotacion`), inventario x ítem, kardex |
| `rotacion_v4` | Servidor (ETL) | Rotación de prueba (`/rotacion-dos`); mismos datos diarios, esquema alineado con la tabla legacy |
| `rotacion_abcd_config` | Creada en runtime por `/api/rotacion` | Umbrales ABCD globales |
| `rotacion_abcd_config_sede` | Idem | Umbrales ABCD por empresa/sede |
| `rotacion_cero_item_estado` | `schema-auth` / migraciones | Estado operativo ítem (cero / restock) |
| `rotacion_cero_item_estado_audit` | `20260515_*` | Historial de cambios de estado |

**Esquema actual de rotación (referencia):** la app detecta columnas vía `information_schema` (`src/lib/rotacion/base-fields.ts`). Forma habitual: `fecha_dia`, `empresa`, `sede`, `id_item`, `id_linea_nivel_1`, `id_categoria`, ventas, costos, inventario, fechas última venta/ingreso, etc. Esquema legacy con `fecha_consulta` / `item` aún soportado con índices condicionales en `20260423_rotacion_perf_indexes.sql`.

**Índices rotación (migraciones):**

| Migración | Índices |
| --- | --- |
| `20260423_*` | Legacy (`fecha_consulta`, …) solo si existen esas columnas |
| `20260427_*` | `rotacion_base_new_idx_*` sobre `fecha_dia`, empresa, sede, item, línea N1, categoría |

**`rotacion_cero_item_estado`:**

| Columna | Notas |
| --- | --- |
| PK | `(sede_id, item, context)` — `context` ∈ `cero` \| `restock` (`20260514_*`) |
| `estado` | `sin_verificar`, `seguimiento`, `surtido` |
| `updated_by` | FK opcional a `app_users` |

**APIs:** `/api/rotacion`, `/api/rotacion-dos` (lee `rotacion_v4`), `/api/rotacion/cero-estados/*`, `/api/inventario-x-item`, `/api/kardex/*`.

**Carga de datos:** `rotacion_base_item_dia_sede` se actualiza por proceso **externo** a esta app; no hay job documentado en el repo.

---

### 4.5 Ventas por ítem

**Origen:** `db/migrations/20260303_ventas_x_item.sql`.

| Tabla | Rol |
| --- | --- |
| `ventas_item_cargas` | Metadatos de cada carga ETL |
| `ventas_item_diario` | Hechos diarios por empresa, CO, ítem, línea |
| `ventas_item_sede_map` | Mapeo `empresa_norm` + `id_co_norm` → nombre sede |

**Índices:**

- UNIQUE natural: `(fecha_dcto, empresa_norm/id_co_norm, id_item, linea)`
- `ventas_item_diario_idx_fecha`, `_empresa`, `_item`, `_sede`

**APIs:** `/api/ventas-x-item`, `/api/ventas-x-item/v2`.

---

### 4.6 Horarios (planillas guardadas)

**Origen:** `db/migrations/20260409_ingresar_horarios.sql`.

| Tabla | Rol |
| --- | --- |
| `horario_planillas` | Cabecera (sede, sección, rango fechas, autor) |
| `horario_planilla_detalles` | Filas por empleado y día (`day_key`, marcaciones HE/HS) |

**Índices:** sede+fechas, `created_at`, `planilla_id`, empleado+fecha, `worked_date`.

**APIs:** `/api/ingresar-horarios/*`, `/api/horarios-comparar` (también lee `asistencia_horas`).

---

### 4.7 Inventario x ítem — presets de usuario

**Origen:** `db/migrations/20260504_inventario_x_item_user_presets.sql`.

| Tabla | Rol |
| --- | --- |
| `inventario_x_item_user_presets` | JSON de presets por `user_id` (PK) |

**Índice:** `(updated_at DESC)`.

**API:** `/api/inventario-x-item/presets`.

---

### 4.8 Excel DIAN (bases opcionales)

No forman parte del schema principal del visor. Consultas en `src/lib/excel-dian/` sobre tablas típicas:

- `public.cmmovimiento_pdv`
- `public.cgmovimiento_contable`
- `public.items`, `public.terceros`, `public.tipos_documentos`

**API:** `/api/excel-dian/export`. Variables `EXCEL_DIAN_*_DB_*` por empresa.

---

## 5. Diagrama de dependencias (auth y app)

```text
app_users
  ├── app_user_sessions (user_id)
  ├── app_user_login_logs (user_id)
  ├── horario_planillas (created_by_user_id)
  ├── inventario_x_item_user_presets (user_id)
  ├── rotacion_cero_item_estado (updated_by)
  └── rotacion_cero_item_estado_audit (changed_by)

horario_planillas
  └── horario_planilla_detalles (planilla_id)

ventas_item_cargas
  └── ventas_item_diario (source_load_id, opcional)
```

---

## 6. Consultas útiles en pgAdmin

**Índices de una tabla:**

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'app_users'
ORDER BY indexname;
```

**Columnas de `asistencia_horas` (servidor):**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'asistencia_horas'
ORDER BY ordinal_position;
```

**Tamaño y último vacuum:**

```sql
SELECT relname, n_live_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables
WHERE relname IN (
  'asistencia_horas',
  'rotacion_base_item_dia_sede',
  'ventas_item_diario',
  'app_user_login_logs'
)
ORDER BY relname;
```

**Mantenimiento manual (tablas grandes, tras cargas masivas):**

```sql
VACUUM (ANALYZE) rotacion_base_item_dia_sede;
VACUUM (ANALYZE) asistencia_horas;
VACUUM (ANALYZE) ventas_item_diario;
```

Ejecutar en ventana de baja carga; no está automatizado desde la app.

---

## 7. Vacíos conocidos (completar en servidor)

Marca en tu entorno lo que ya exista; el repo no lo garantiza:

| Tema | Acción sugerida |
| --- | --- |
| DDL de `ventas_*` y `asistencia_horas` | Exportar `\d+ tabla` desde producción y archivar en `docs/` o migración de referencia |
| Índices en `margenes_linea_co_dia` | Revisar `EXPLAIN ANALYZE` de `/api/margenes` |
| Índice único asistencia | Documentar si existe `ux_asistencia_numero_fecha` |
| Frecuencia ETL rotación / ventas | Anotar horario y responsable del proceso |
| Limpieza de sesiones | No hay job; sesiones expiradas pueden acumularse en `app_user_sessions` |
| IP en login logs | Requiere proxy + `TRUST_PROXY=true` o IP directa al Node |

---

## 8. Cuándo actualizar este documento

- Nueva migración en `db/migrations/`.
- Nueva tabla consultada desde `src/app/api/`.
- Cambio de columnas detectadas dinámicamente (asistencia / rotación).
- Nuevos índices de rendimiento acordados en producción.
- Nueva base Excel DIAN o cambio de tablas DIAN.

*Referencia de código: mayo 2026.*
