# Base de datos - Visor de Productividad

Referencia de tablas, migraciones e indices usados por la aplicacion. Para
arquitectura general ver [`../README.md`](../README.md). Para estructura de
codigo ver [`STRUCTURE.md`](STRUCTURE.md).

Estado de referencia: codigo versionado revisado el **2026-06-10**.

## 1. Conexion y entorno

| Variable | Uso |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | pool principal en `src/lib/db/index.ts` |
| `DB_SCHEMA` | `search_path`/schema por defecto; default `public` |
| `DB_SSL` | usado por `scripts/cleanup-logs.sh`; si es `true`, exporta `PGSSLMODE=require` |
| `AUDIT_IP_HMAC_SECRET` | si existe, guarda IP auditada como HMAC truncado |
| `TRUST_PROXY=true` | permite leer `x-forwarded-for` en endpoints que usan `getClientIp` |

Usuario PostgreSQL operativo habitual: `produ` (ver `db/crear-usuario.sql` y
`db/permisos-usuario.sql`).

## 2. Que esta en Git vs que asume el servidor

En el repo:

- auth y administracion (`app_users`, sesiones, login logs);
- permisos por sede/linea/seccion/subtablero;
- ventas x item;
- horarios guardados;
- presets de inventario;
- estados/auditoria de cero rotacion/restock;
- indices de rendimiento parciales.

Suele existir solo en el servidor o en procesos ETL externos:

- `ventas_*`;
- `asistencia_horas`;
- `margenes_linea_co_dia`;
- `rotacion_base_item_dia_sede`;
- `rotacion_v4`;
- tablas DIAN como `cmmovimiento_pdv`, `cgmovimiento_contable`, `items`,
  `terceros`, `tipos_documentos`.

La app lee esas tablas. Si faltan columnas esperadas, algunos endpoints fallan
o degradan; rotacion y asistencia tienen deteccion dinamica parcial.

## 3. Aplicar esquema

1. Aplicar `db/schema-auth.sql`.
2. Aplicar migraciones de `db/migrations/` en orden por fecha.
3. Verificar con `npm run db:test` o `npm run db:test:postgres`.

Orden completo despues de `schema-auth.sql`:

1. `20260203_auth_username.sql`
2. `20260220_user_sede.sql`
3. `20260224_user_allowed_lines.sql`
4. `20260227_user_allowed_dashboards.sql`
5. `20260302_user_allowed_sedes.sql`
6. `20260303_ventas_x_item.sql`
7. `20260305_user_special_roles.sql`
8. `20260409_ingresar_horarios.sql`
9. `20260423_rotacion_perf_indexes.sql`
10. `20260424_user_allowed_subdashboards.sql`
11. `20260427_rotacion_new_fields_indexes.sql`
12. `20260429_rotacion_cero_item_estado.sql`
13. `20260429_rotacion_cero_item_estado_values.sql`
14. `20260504_inventario_x_item_user_presets.sql`
15. `20260514_rotacion_cero_item_estado_restock_context.sql`
16. `20260515_rotacion_cero_item_estado_audit.sql`
17. `20260516_productividad_x_linea_indexes.sql`
18. `20260520_rotacion_v4_perf_indexes.sql`
19. `20260520_session_last_activity.sql`
20. `20260520_session_last_path.sql`
21. `20260526_user_activity_log.sql`
22. `20260529_ventas_x_item_perf_indexes.sql`
23. `20260603_rotacion_cero_item_estado_empresa.sql`
24. `20260616_rotacion_clean_matview.sql`
25. `20260617_rotacion_periodo_std.sql`
26. `20260618_rotacion_refresh_timeouts.sql`
27. `20260619_rotacion_periodo_std_fix_groupby.sql`

## 4. Dominios y tablas

### 4.1 Auth, sesiones y administracion

| Tabla | Descripcion | Notas |
| --- | --- | --- |
| `app_users` | usuarios, roles y permisos | `username` unico, `role` `admin`/`user` |
| `app_user_sessions` | sesiones activas/revocadas | `token_hash`, `expires_at`, `last_activity_at`, `last_path` |
| `app_user_login_logs` | bitacora de login | IP auditada, User-Agent, fecha |
| `app_user_activity_log` | actividad por heartbeat | una observacion por usuario/sesion/ruta, deduplicada por ventana corta |

Columnas relevantes de `app_users`:

| Columna | Uso |
| --- | --- |
| `username`, `password_hash` | login con bcrypt |
| `role` | `admin` o `user` |
| `sede` | fallback legacy |
| `allowed_sedes` | JSONB de sedes visibles |
| `allowed_lines` | lineas visibles |
| `allowed_dashboards` | secciones UAID |
| `allowed_subdashboards` | permisos granulares |
| `special_roles` | capacidades especiales |
| `is_active` | bloqueo de acceso |
| `last_login_at`, `last_login_ip` | trazabilidad |

APIs relacionadas: `/api/auth/*`, `/api/admin/users*`,
`/api/admin/login-logs`, `/api/admin/user-presence`,
`/api/admin/users/[id]/metrics`.

### 4.2 Productividad y analisis horario

| Tabla | Uso |
| --- | --- |
| `ventas_cajas` | linea cajas |
| `ventas_fruver` | fruver |
| `ventas_industria` | industria |
| `ventas_carnes` | carnes |
| `ventas_pollo_pesc` | pollo/pescado |
| `ventas_asadero` | asadero |
| `asistencia_horas` | horas laboradas, marcaciones, presencia y jornada extendida |

Indices versionados:

- `20260516_productividad_x_linea_indexes.sql` crea indices por
  `(fecha_dcto, centro_operacion, empresa_bd)` en ventas y
  `(fecha, sede, departamento)` en `asistencia_horas`.

APIs relacionadas: `/api/productivity`, `/api/hourly-analysis`,
`/api/jornada-extendida/*`.

Notas:

- `/api/productivity` usa `PRODUCTIVITY_CACHE_PATH` y opcionalmente
  `PRODUCTIVITY_SERVE_FILE_CACHE`.
- `src/lib/horarios/ocultar-cedulas.ts` excluye cedulas del analisis para no
  admins.
- `asistencia_horas` no tiene DDL completo en el repo.

### 4.3 Margenes

| Tabla | Uso |
| --- | --- |
| `margenes_linea_co_dia` | agregados por linea/sede/dia |

API: `/api/margenes`.

Regla de margen agregado: `SUM(margen) / SUM(ventas) * 100`; no promediar
porcentajes.

No hay migracion versionada de indices para esta tabla; revisar `EXPLAIN
ANALYZE` si crece el volumen.

### 4.4 Rotacion, inventario y kardex

| Tabla | Origen | Uso |
| --- | --- | --- |
| `rotacion_base_item_dia_sede` | ETL/servidor | rotacion, inventario x item, kardex |
| `rotacion_item_dia_clean` | matview (migracion) | pre-limpia/agrega diario para `/api/rotacion` |
| `rotacion_item_periodo_std` | refresh nocturno | snapshot agregado rango rolling default (~1-3 s) |
| `rotacion_item_periodo_std_meta` | refresh nocturno | periodo_start/end y refreshed_at del snapshot |
| `rotacion_v4` | ETL/servidor | vista tecnica `/rotacion-dos` |
| `rotacion_abcd_config` | runtime/API | umbrales ABCD globales |
| `rotacion_abcd_config_sede` | runtime/API | umbrales ABCD por empresa/sede |
| `rotacion_cero_item_estado` | migraciones | estado operativo cero/restock |
| `rotacion_cero_item_estado_audit` | migraciones | historial de cambios |

`rotacion_cero_item_estado` usa PK actual
`(empresa, sede_id, item, context)`. La migracion
`20260603_rotacion_cero_item_estado_empresa.sql` agrego `empresa` porque
`sede_id` no es unico entre empresas.

Indices versionados:

- `20260423_rotacion_perf_indexes.sql`: indices condicionales para esquema legacy.
- `20260427_rotacion_new_fields_indexes.sql`: indices para esquema con
  `fecha_dia`, empresa, sede, item, linea N1 y categoria.
- `20260520_rotacion_v4_perf_indexes.sql`: indices para `rotacion_v4`.

APIs relacionadas: `/api/rotacion`, `/api/rotacion-dos`,
`/api/rotacion/cero-estados`, `/api/rotacion/cero-estados/audit`,
`/api/inventario-x-item`, `/api/kardex/*`.

### 4.5 Ventas por item

| Tabla | Rol |
| --- | --- |
| `ventas_item_cargas` | metadata de cargas |
| `ventas_item_diario` | hechos diarios por empresa/CO/item/linea |
| `ventas_item_sede_map` | mapeo empresa+CO hacia sede |

Migraciones:

- `20260303_ventas_x_item.sql`: tablas base.
- `20260529_ventas_x_item_perf_indexes.sql`: indices de rendimiento.

APIs: `/api/ventas-x-item`, `/api/ventas-x-item/v2`.

### 4.6 Horarios y planillas

| Tabla | Rol |
| --- | --- |
| `horario_planillas` | cabecera por sede/seccion/rango/autor |
| `horario_planilla_detalles` | filas por empleado y dia |

Origen: `20260409_ingresar_horarios.sql`.

APIs: `/api/ingresar-horarios/*`, `/api/horarios-comparar`.

### 4.7 Inventario presets

| Tabla | Rol |
| --- | --- |
| `inventario_x_item_user_presets` | JSON de presets por `user_id` |

Origen: `20260504_inventario_x_item_user_presets.sql`.

API: `/api/inventario-x-item/presets`.

### 4.8 Excel DIAN

No forma parte del schema principal del visor. Usa conexiones PostgreSQL por
empresa (`EXCEL_DIAN_MTDO_DB_*`, `EXCEL_DIAN_MIO_DB_*`,
`EXCEL_DIAN_BGT_DB_*`) y consultas en `src/lib/excel-dian/`.

API: `/api/excel-dian/export`.

### 4.9 Cronograma Notion

No usa tablas locales. `/api/cronograma` consulta Notion con `NOTION_TOKEN` y
`NOTION_CRONOGRAMA_PAGE_ID`, normaliza bases de datos embebidas y responde al
cliente autenticado.

## 5. Relaciones principales

```text
app_users
  -> app_user_sessions
  -> app_user_login_logs
  -> app_user_activity_log
  -> horario_planillas
  -> inventario_x_item_user_presets
  -> rotacion_cero_item_estado.updated_by
  -> rotacion_cero_item_estado_audit.changed_by

horario_planillas
  -> horario_planilla_detalles

ventas_item_cargas
  -> ventas_item_diario
```

## 6. Limpieza y retencion

`scripts/cleanup-logs.sh` borra registros antiguos de:

- `app_user_activity_log` por `observed_at`;
- `app_user_login_logs` por `logged_at`;
- `app_user_sessions` expiradas o con `created_at` anterior a la retencion.

El timer systemd esta en `deploy/systemd/`. Ver [`../deploy/README.md`](../deploy/README.md)
y [`DEPLOYMENT.md`](DEPLOYMENT.md).

Default operativo: `RETENTION_DAYS=7`.

## 7. Consultas utiles

Indices de una tabla:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'app_users'
ORDER BY indexname;
```

Columnas de una tabla ETL:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'asistencia_horas'
ORDER BY ordinal_position;
```

Tamanos y vacuum:

```sql
SELECT relname, n_live_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables
WHERE relname IN (
  'app_user_activity_log',
  'app_user_login_logs',
  'app_user_sessions',
  'asistencia_horas',
  'rotacion_base_item_dia_sede',
  'ventas_item_diario'
)
ORDER BY relname;
```

Mantenimiento manual tras cargas grandes:

```sql
VACUUM (ANALYZE) rotacion_base_item_dia_sede;
VACUUM (ANALYZE) asistencia_horas;
VACUUM (ANALYZE) ventas_item_diario;
```

## 8. Vacios conocidos

| Tema | Accion sugerida |
| --- | --- |
| DDL completo de tablas ETL | exportar desde produccion y archivar como referencia |
| Indices de `margenes_linea_co_dia` | revisar planes reales y versionar indices si aplica |
| Jobs ETL de ventas/rotacion/asistencia | documentar frecuencia, responsable y validaciones |
| Store distribuido para rate limit/cache | requerido si se escala a multiples replicas |
| Retencion historica | confirmar si 7 dias de actividad/login es suficiente para auditoria |

Actualizar este documento cuando cambien migraciones, tablas leidas, columnas
dinamicas, indices acordados en produccion o bases externas.
