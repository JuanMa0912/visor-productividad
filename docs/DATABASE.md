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
28. `20260622_margen_final.sql` (si aplica tablero margenes nuevo)
29. `20260702_margen_final_roll.sql` (rollup factura+item para `/margenes`; poblar con `npm run margen:refresh-roll`)
30. `20260623_app_user_ui_state.sql`
31. `20260624_ventas_x_item_summary_covering_index.sql`
32. `20260704_app_users_portal_profile.sql` (perfiles de portal en `app_users`)
33. `20260705_rotacion_sublinea.sql` (columnas N2 en `rotacion_base_item_dia_sede`)
34. `20260706_rotacion_clean_matview_sublinea.sql` (matview con `linea_n2_codigo`/`sublinea`)
35. `20260707_rotacion_periodo_std_sublinea.sql` (snapshot periodo std con N2)
36. `20260708_rotacion_clean_matview_n2_stable.sql` (N2 estable en matview + indice filtro)
37. `20260708_margen_item_dia_roll.sql` (rollup dia+item sin factura para `/informe-variacion`; se refresca al final de `margen:refresh-roll`)
38. `20260709_app_users_portal_profile_asadero.sql` (añade perfil `asadero` al CHECK de `portal_profile`)
39. `20260710_margen_item_dia_roll_margin.sql` (añade `costo_total`/`margen_pesos` al rollup dia+item para margen % en informe variacion)
40. `20260715_margen_item_dia_roll_atomic_refresh.sql` (rebuild completo via staging+rename; evita vaciar la tabla durante el refresh)
41. `20260715_user_audit_trail.sql` (`app_user_admin_audit` + `app_user_login_attempt_log`)
42. `20260716_informe_variacion_payload_std.sql` (snapshot JSON de `/informe-variacion` para first paint rapido)
43. `20260721_app_export_download_log.sql` (bitacora de descargas/exports; solo metadatos; retencion ~9 meses)
44. `20260721_margen_factura_cliente.sql` (`documento_docfc`/`id_terc`/`nombre_terc` en `margen_final` + roll)
45. `20260722_margen_factura_caja_vendedor.sql` (`id_caja`/`vend_cc`/`vend_cc_desc` en roll; refresh con MAX por factura)
46. `20260723_margen_cliente_perf_indexes.sql` (indices `id_terc`/`documento_fc` en roll para pestaña Por Cliente)
47. `20260723_dinastia_tenant_tables.sql` (tablas `margen_dinastia` / `rotacion_dinastia` / `ventas_dinastia` + `app_users.allowed_empresas`)
48. `20260723_rotacion_dinastia_matview.sql` (matview `rotacion_dinastia_item_dia_clean` + snapshot `rotacion_dinastia_item_periodo_std`)
49. `20260724_margen_dinastia_roll.sql` (rollup factura+item `margen_dinastia_roll` + `refresh_margen_dinastia_roll`)
51. `20260803_app_users_display_name.sql` (`app_users.display_name`: nombre real / nota bajo username en admin)
52. `20260805_proveedores_visitas.sql` + `20260805_proveedores_visitas_pos_catalog.sql` (QR proveedores)
53. `20260811_proveedor_visitas_por_sede.sql` (marcaciones QR en tablas físicas `qr_*` por sede; vista `proveedor_visitas`)
54. `20260813_qr_visitas_autorizacion_datos.sql` (`autorizacion_datos_at` en `qr_*`; recrea vista `proveedor_visitas`)
55. `20260813_orden_compra.sql` (snapshot cabecera OC: POS `cmmovimiento_ocompra` -> `orden_compra`)
56. `20260818_orden_compra_linea.sql` (lineas OC: item + tercero real desde el mismo POS)
57. `20260820_margen_item_mes_roll.sql` (agregado mensual para `/informe-variacion` YTD; se refresca al final de `margen:refresh-roll` y `refresh-variacion-roll.sh`)
58. `20260820_rotacion_gestion_semana_roll.sql` (tendencia semanal D/0/S aproximada para `/rotacion` Grafico; `SELECT * FROM refresh_rotacion_gestion_semana_roll();`, tambien al final de `refresh-rotacion-matview.sh`)

Tras `20260708_rotacion_clean_matview_n2_stable` (y/o `20260723_rotacion_dinastia_matview`), refrescar matview y snapshot **via psql** (no pegar el SQL directo en bash):

```bash
sudo -u visor /bin/bash /opt/visor-productividad/scripts/refresh-rotacion-matview.sh
```

El script lee `.env.local` y refresca legacy + Dinastia. Si solo quieres Dinastia a mano:

```bash
sudo -u visor bash -lc '
set -a; source /opt/visor-productividad/.env.local; set +a
export PGPASSWORD="$DB_PASSWORD"
export PGSSLMODE="${DB_SSL:-require}"
psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
SET statement_timeout = 0;
REFRESH MATERIALIZED VIEW rotacion_dinastia_item_dia_clean;
ANALYZE rotacion_dinastia_item_dia_clean;
SELECT * FROM refresh_rotacion_dinastia_item_periodo_std();
SQL
'
```

Panel de gestion (tendencia semanal). Aplicar una vez y poblar el roll:

```bash
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260820_rotacion_gestion_semana_roll.sql
sudo -u visor /bin/bash /opt/visor-productividad/scripts/refresh-rotacion-matview.sh --periodo-only
```

`--periodo-only` igual corre `refresh_rotacion_gestion_semana_roll()` al final. La primera carga de 26 semanas puede tardar; las noches siguientes reescriben las semanas recientes.

### 4.1 Auth, sesiones y administracion

| Tabla | Descripcion | Notas |
| --- | --- | --- |
| `app_users` | usuarios, roles y permisos | `username` unico, `role` `admin`/`user` |
| `app_user_sessions` | sesiones activas/revocadas | `token_hash`, `expires_at`, `last_activity_at`, `last_path` |
| `app_user_login_logs` | bitacora de login exitoso | IP auditada, User-Agent, fecha |
| `app_user_login_attempt_log` | intentos de login fallidos | motivo (`unknown_user`, `bad_password`, `inactive`, `rate_limited`, `other`) |
| `app_user_admin_audit` | mutaciones admin sobre usuarios | before/after JSONB, campos cambiados, actor |
| `app_user_activity_log` | actividad por heartbeat | una observacion por usuario/sesion/ruta, deduplicada por ventana corta |
| `app_export_download_log` | descargas/exports | usuario, panel, formato, archivo, rango fechas, filtros JSON; sin binario; retencion ~9 meses |

Columnas relevantes de `app_users`:

| Columna | Uso |
| --- | --- |
| `username`, `password_hash` | login con bcrypt |
| `display_name` | nombre real / nota corta (visible bajo username en `/admin/usuarios`) |
| `role` | `admin` o `user` |
| `sede` | fallback legacy |
| `allowed_sedes` | JSONB de sedes visibles |
| `allowed_empresas` | JSONB de empresas BD (`mercamio`, `mtodo`, `bogota`, `dinastia`); `NULL` = todas |
| `allowed_lines` | lineas visibles |
| `allowed_dashboards` | secciones UAID |
| `allowed_subdashboards` | permisos granulares |
| `special_roles` | capacidades especiales |
| `portal_profile` | perfil de negocio (`admin`, `subadmin`, `gerente`, `director_comercial`, `asadero`, `fruver`, `rrhh`, `personalizado`) |
| `is_active` | bloqueo de acceso |
| `password_changed_at` | ultimo cambio de contraseña (rotacion cada 30 dias) |
| `last_login_at`, `last_login_ip` | trazabilidad |

`app_user_sessions.password_change_required` y `password_change_reason` marcan sesiones que deben ir a `/cuenta/contrasena` antes de usar el portal.

Migracion: `db/migrations/20260701_app_users_password_policy.sql`.

APIs relacionadas: `/api/auth/*`, `/api/admin/users*`,
`/api/admin/login-logs`, `/api/admin/login-failures`, `/api/admin/audit`,
`/api/admin/exports`, `/api/exports/log`,
`/api/admin/user-presence`, `/api/admin/users/[id]/metrics`.

UI: `/admin/usuarios/auditoria` (cambios admin + fallos de login; export CSV),
`/admin/usuarios/descargas` (metadatos de Excel/PDF/CSV/imagenes; solo admin).

Aplicar migracion 41:

```bash
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260715_user_audit_trail.sql
```

Aplicar migracion 44 (descargas):

```bash
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260721_app_export_download_log.sql
```

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
  `PRODUCTIVITY_SERVE_FILE_CACHE`. Cache memoria `productivity:full-v4`; un JSON
  de disco sin `volumeSchema=4` o sin campos de volumen se ignora y se regenera.
- Las tarjetas de Mix y Línea (`/` → `LineCard`) ya no muestran ventas. Volumen:
  Cajas = `COUNT(*)` de tickets con `total_bruto > 0` en `ventas_cajas`;
  Industria = `SUM(cantidad)` und menos unidades de proveedores con visita QR
  ese día en esa sede (cruce `qr_*` + `proveedor_item` por código y NIT);
  Fruver/Carnes/Pollo y pescado = `SUM(cantidad)` kg;
  Asadero = UND.Pollo (misma conversión que Informe Variación) + unidades no-pollo.
  KG/und salen de `margen_item_dia_roll` (cat. 4 / cat. 3). Las ventas `$` siguen
  en el payload para Excel/PDF y comparativos.
- `src/lib/horarios/ocultar-cedulas.ts` excluye cedulas del analisis para no
  admins.
- `asistencia_horas` no tiene DDL completo en el repo.

### 4.3 Margenes

| Tabla | Uso |
| --- | --- |
| `margenes_linea_co_dia` | legacy: agregados por linea/sede/dia (feb 2026 en prod) |
| `margen_final` | detalle linea/factura; CSV `movimiento_unificado_*`; `fecha_dcto` YYYYMMDD; incluye `id_caja`, `vend_cc`/`vend_cc_desc`, `documento_docfc`, `id_terc`/`nombre_terc` |
| `margen_final_roll` | rollup factura+item/dia/sede; alimenta `/margenes` (Producto/Factura/Cliente/Sede); atributos de factura vía MAX |
| `margen_item_dia_roll` | rollup dia+sede+item (sin factura); fuente preferida de `/informe-variacion` y del volumen de tarjetas Mix y Línea |
| `margen_item_mes_roll` | rollup mes+sede+item (YYYYMM) derivado de `margen_item_dia_roll`; acelera comparativos YTD de `/informe-variacion` |
| `margen_dinastia` | mismo esquema que `margen_final` para empresa Dinastia (tenant aparte; sedes `001` Santa Elena / `002` CR Primera). Productividad (`ventas_dinastia`) pendiente. |
| `margen_dinastia_roll` | rollup factura+item desde `margen_dinastia`; alimenta `/margenes` e `/informe-variacion` tenant Dinastia (sin `item_dia` dedicado; el informe arma bundle rango-a-rango). |
| `informe_variacion_payload_std` | snapshot JSONB del payload por (year, month, range_id, scope=`*`); first paint &lt;2s (también para usuarios con sedes/línea: se recorta en servidor) |
| `informe_variacion_payload_std_meta` | ultimo warm (refreshed_at, mes, #rangos) |
| `margenes_linea_co_dia_clean` | matview legacy sobre `margenes_linea_co_dia` |

API: `/api/margenes` (legacy), `/api/margenes/meta` (bounds de `margen_final` o `margen_dinastia` segun `?empresa=` / usuario solo-Dinastia),
`/api/margenes/data` (tablero drill; Dinastia usa `margen_dinastia_roll` si esta poblado, si no fallback a crudo), `/api/informe-variacion` (prefiere
`margen_item_dia_roll` si existe y tiene filas).

Verificar / poblar roll Dinastia:

```bash
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260724_margen_dinastia_roll.sql
sudo -u visor env MARGEN_ROLL_SINGLE=1 npm run margen:refresh-roll
# solo Dinastia incremental:
sudo -u visor bash -lc '
set -a; source /opt/visor-productividad/.env.local; set +a
export PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require
psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -c "
SET statement_timeout = 0;
SELECT * FROM refresh_margen_dinastia_roll();
"
'
```

En `/margenes`, sin categoría seleccionada el tablero default es Mercado
(`id_tipo = 4`) **solo en tablas legacy**. En Dinastia (`margen_dinastia` /
`margen_dinastia_roll`) no se fuerza Mercado porque el feed usa `id_tipo = 1`.
Con categoría explícita (perfil asadero → `3`) no se aplica ese default; ver
`shouldApplyMercadoTipoDefault` / `shouldSkipMercadoTipoDefault`.

Migraciones: `db/migrations/20260622_margen_final.sql`, `db/migrations/20260702_margen_final_roll.sql`,
`db/migrations/20260708_margen_item_dia_roll.sql`, `db/migrations/20260721_margen_factura_cliente.sql`,
`db/migrations/20260722_margen_factura_caja_vendedor.sql`,
`db/migrations/20260723_margen_cliente_perf_indexes.sql`.

En el tablero `/margenes`: pestaña **Por Cliente** agrupa por `id_terc`; al
abrir una factura se muestran Cliente, Caja, Consecutivo, Vendedor y Documento
(`documento_docfc`). Esas columnas son **obligatorias** en `margen_final_roll`
(no hay fallback a NULL). Tras las migraciones 45–46 hay que refrescar el roll
(al menos desde `20260701`, fecha desde la que el ETL llena cliente/docfc).
Tras la 47 (indices de cliente/documento) no hace falta refresh; solo aplicar:

```bash
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260721_margen_factura_cliente.sql
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260722_margen_factura_caja_vendedor.sql
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260723_margen_cliente_perf_indexes.sql
# incremental (recomendado) o full:
sudo -u visor env MARGEN_ROLL_FROM=20260701 MARGEN_ROLL_TO=20260722 npm run margen:refresh-roll
```

`npm run margen:refresh-roll` y `/api/margenes/data` fallan con mensaje claro si
faltan esas columnas en el roll.

**Refresh automatico (dos caminos):**

1. Sync diario `visor-etl-sync.timer` (07:50): al subir `margen_final`,
   `scripts/etl/sync-local-to-gcp.sh` refresca la ventana sincronizada de
   `margen_final_roll` y `margen_item_dia_roll`.
2. Timer dedicado `visor-refresh-variacion.timer` (08:15 en app-server):
   `scripts/refresh-variacion-roll.sh` refresca ventana ~60 dias (incremental),
   actualiza `margen_item_mes_roll` y materializa `informe_variacion_payload_std`
   con el comparativo YTD por defecto (1 ene → maxDate vs mismo tramo año anterior).
   Rebuild total del roll: `--full`.

No hace falta una tabla nueva en GCP: `margen_item_mes_roll` se arma en Postgres
desde `margen_item_dia_roll`. Tras desplegar, aplicar la migracion y un refresh:

```bash
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260820_margen_item_mes_roll.sql
sudo -u visor npm run margen:refresh-roll
sudo -u visor npm run informe:warm-snapshot
```

Warm manual del snapshot (tras aplicar migracion 42):

```bash
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260716_informe_variacion_payload_std.sql
sudo -u visor npm run informe:warm-snapshot
# Header de respuesta: X-Data-Source: payload-std | cache | database
```

Usuarios con sedes/tipos restringidos siguen el path SQL + cache de proceso.

Tras migracion nueva o backfill puntual (en GCP como usuario `visor`):

```bash
cd /opt/visor-productividad
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260702_margen_final_roll.sql   # solo la primera vez
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260703_margen_final_roll_refresh_chunks.sql
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260708_margen_item_dia_roll.sql  # solo la primera vez
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260710_margen_item_dia_roll_margin.sql  # margen % en informe
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260715_margen_item_dia_roll_atomic_refresh.sql
sudo -u visor npm run margen:refresh-roll
```

`margen:refresh-roll` pobla `margen_final_roll`, `margen_item_dia_roll` y `margen_item_mes_roll`.

Equivalente SQL (misma conexion remota que `DB_HOST` en `.env.local`):

```bash
sudo -u visor npm run db:test:postgres   # verifica host/usuario
# o: sudo -u visor node -e "..." con resolvePgClientConfig — preferir npm run margen:refresh-roll
```

La API usa `margen_final_roll` automaticamente si existe y tiene filas (`MARGEN_FORCE_RAW=1` fuerza detalle).

Regla de margen agregado: `SUM(margen) / SUM(ventas) * 100`; no promediar
porcentajes.

### 4.4 Rotacion, inventario y kardex

| Tabla | Origen | Uso |
| --- | --- | --- |
| `rotacion_base_item_dia_sede` | ETL/servidor | rotacion, inventario x item, kardex |
| `rotacion_item_dia_clean` | matview (migracion) | pre-limpia/agrega diario para `/api/rotacion`; expone `linea_n2_codigo` y `sublinea` (migraciones `20260706`/`20260708`). Excluye categoria Asaderos (`3`) y `V` |
| `rotacion_item_periodo_std` | refresh nocturno | snapshot agregado rango rolling default (~1-3 s); hereda exclusion de cat. `3`/`V` de la matview |
| `rotacion_item_periodo_std_meta` | refresh nocturno | periodo_start/end y refreshed_at del snapshot |
| `rotacion_dinastia_item_dia_clean` | matview (`20260723_rotacion_dinastia_matview`) | mismo rol que `rotacion_item_dia_clean` sobre `rotacion_dinastia` |
| `rotacion_dinastia_item_periodo_std` | refresh nocturno | snapshot rolling default para tenant Dinastia |
| `rotacion_dinastia_item_periodo_std_meta` | refresh nocturno | meta del snapshot Dinastia |
| `rotacion_salidas_dia` | ETL (`scripts/etl/rotacion-dim`) | movimientos de inventario que no son venta PDV; el tipo `EK` (ensamble de kit) alimenta el denominador del DIC. Solo tenant legacy |
| `rotacion_v4` | ETL/servidor (legacy, sin UI en portal) |
| `rotacion_abcd_config` | runtime/API | umbrales ABCD globales |
| `rotacion_abcd_config_sede` | runtime/API | umbrales ABCD por empresa/sede |
| `rotacion_cero_item_estado` | migraciones | estado operativo cero/restock |
| `rotacion_cero_item_estado_audit` | migraciones | historial de cambios |
| `rotacion_restock_surtido_foto` | migraciones | foto JPEG/PNG/WebP en base64 de items restock ya surtidos |
| `rotacion_gestion_semana_roll` | refresh nocturno | tendencia semanal (ventana 30d) de D/0/S aproximado para el panel de gestion; `demandaD` = DI≥45 (no es ABCD D) |

DIC (dias de inventario) = `inventory_units * tracked_days / demanda_units`, con
`demanda_units = total_units + uds_equivalentes` y `uds_equivalentes` = salidas
del documento `EK` en la ventana (`rotacion_salidas_dia`, `ind_es = 2`). El POS
cobra el multipack en el codigo padre pero descuenta el inventario del hijo, asi
que sin ese termino el hijo sale con DIC absurdo. Bordes: sin inventario -> `0`;
sin demanda o sin dias -> `999999`.

La formula esta escrita en cuatro sitios que deben moverse juntos:
`refresh_rotacion_item_periodo_std()` (snapshot),
`buildRotacionMatviewSql` y el query sobre tabla cruda en
`src/app/api/rotacion/route.ts` (rangos fuera del snapshot) y
`buildConsolidatedRowsBySelection` en `src/app/rotacion/rotacion-preamble.ts`
(consolidado de sedes, que re-divide porque el DIC no es aditivo). Si
`rotacion_salidas_dia` no existe, todos caen al denominador viejo (solo venta
PDV) y el resultado es el previo al cambio.

Comprobar que el camino en vivo y el snapshot coinciden (no sirve compararlo por
HTTP: para la ventana del snapshot el endpoint siempre sirve el snapshot):

```sql
-- 0 filas = camino en vivo y snapshot dan el mismo denominador.
WITH m AS (
  SELECT periodo_start, periodo_end FROM rotacion_item_periodo_std_meta WHERE id = 1
),
eq AS (
  SELECT s.empresa, s.sede AS sede_id, s.id_item AS item,
         GREATEST(SUM(-s.unidades), 0)::numeric AS uds_equivalentes
  FROM rotacion_salidas_dia s, m
  WHERE s.fecha_dia BETWEEN m.periodo_start AND m.periodo_end
    AND s.doc_inv_tipo = 'EK' AND s.ind_es = 2
  GROUP BY 1, 2, 3
)
SELECT p.empresa, p.sede_id, p.item, p.demanda_units,
       p.total_units + COALESCE(eq.uds_equivalentes, 0) AS demanda_en_vivo
FROM rotacion_item_periodo_std p
LEFT JOIN eq ON eq.empresa = p.empresa AND eq.sede_id = p.sede_id AND eq.item = p.item
WHERE abs(p.demanda_units - (p.total_units + COALESCE(eq.uds_equivalentes, 0))) > 0.0001;
```

Si sale distinto, el snapshot esta viejo (refrescar) o el `equiv` del SQL en vivo
dejo de ser identico al de la funcion.

`rotacion_cero_item_estado` usa PK actual
`(empresa, sede_id, item, context)`. La migracion
`20260603_rotacion_cero_item_estado_empresa.sql` agrego `empresa` porque
`sede_id` no es unico entre empresas.

Indices versionados:

- `20260423_rotacion_perf_indexes.sql`: indices condicionales para esquema legacy.
- `20260427_rotacion_new_fields_indexes.sql`: indices para esquema con
  `fecha_dia`, empresa, sede, item, linea N1 y categoria.
- `20260520_rotacion_v4_perf_indexes.sql`: indices para `rotacion_v4`.

APIs relacionadas: `/api/rotacion`, `/api/rotacion/cero-estados`,
`/api/rotacion/cero-estados`, `/api/rotacion/cero-estados/audit`,
`/api/inventario-x-item`, `/api/kardex/*`.

Perfil `asadero` (`allowed_lines` solo `asadero`): fuerza categoria de rotacion
`3` y consulta la tabla cruda `rotacion_base_item_dia_sede` (no matview ni
`periodo_std`, que excluyen cat. `3`). Ver
`src/lib/shared/line-category-scope.ts`.

Perfil `fruver` (`allowed_lines` solo `fruver`): fuerza linea N1 `01` en
margen/informe/rotacion (Fruver no es categoria propia como Asaderos). Misma
superficie de tableros que asadero. Ver
`src/lib/shared/line-category-scope.ts`.

### 4.5 Ventas por item

| Tabla | Rol |
| --- | --- |
| `ventas_item_cargas` | metadata de cargas |
| `ventas_item_diario` | hechos diarios por empresa/CO/item/linea |
| `ventas_item_sede_map` | mapeo empresa+CO hacia sede |

Migraciones:

- `20260303_ventas_x_item.sql`: tablas base.
- `20260529_ventas_x_item_perf_indexes.sql`: indices de rendimiento (filtro fecha+empresa, summary).
- `20260624_ventas_x_item_summary_covering_index.sql`: indice covering para GROUP BY summary.

APIs: `/api/ventas-x-item`, `/api/ventas-x-item/v2`.

### 4.6 Horarios y planillas

| Tabla | Rol |
| --- | --- |
| `horario_planillas` | cabecera por sede/seccion/rango/autor |
| `horario_planilla_detalles` | filas por empleado y dia |

Origen: `20260409_ingresar_horarios.sql`.

APIs: `/api/ingresar-horarios/*`, `/api/horarios-comparar`.

### 4.7 Inventario presets y preferencias de UI

| Tabla | Rol |
| --- | --- |
| `inventario_x_item_user_presets` | JSON de presets por `user_id` |
| `app_user_ui_state` | preferencias de UI por usuario (`state` JSONB) |

Origen presets: `20260504_inventario_x_item_user_presets.sql`.

Origen UI state: `20260623_app_user_ui_state.sql`. Claves en `state` (ver `src/lib/ui/tutorial-keys.ts`): `rotacionTutorialV1`, `portalSectionsTutorialV1`, hubs por sección y `jornadaExtendidaTutorialV1`.

APIs: `/api/inventario-x-item/presets`, `/api/ui-state/tutorial?key=...` (genérico). `/api/rotacion/tutorial` se mantiene por compatibilidad.

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
  -> app_user_login_attempt_log
  -> app_user_admin_audit
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
- `app_user_sessions` expiradas o con `created_at` anterior a la retencion;
- `app_user_login_attempt_log` por `logged_at` (retencion `AUDIT_RETENTION_DAYS`, default 90);
- `app_user_admin_audit` por `created_at` (misma retencion de auditoria);
- `app_export_download_log` por `created_at` (retencion `DOWNLOAD_RETENTION_DAYS`, default 274 ~ 9 meses).

El timer systemd esta en `deploy/systemd/`. Ver [`../deploy/README.md`](../deploy/README.md)
y [`DEPLOYMENT.md`](DEPLOYMENT.md).

Default operativo: `RETENTION_DAYS=7`, `AUDIT_RETENTION_DAYS=90`, `DOWNLOAD_RETENTION_DAYS=274`.

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

### 4.x Proveedores (visitas QR)

Migraciones:
`db/migrations/20260805_proveedores_visitas.sql`,
`db/migrations/20260805_proveedores_visitas_pos_catalog.sql`,
`db/migrations/20260811_proveedor_visitas_por_sede.sql`.

| Tabla / vista | Uso |
| --- | --- |
| `proveedor_catalogo` | (opcional / legacy) catálogo propio; el form QR usa `proveedor_tercero` filtrado por empresa de la sede |
| `proveedor_pos_catalogo` | maestro de criterios del ítem (~3.4k): `empresa`+`id_cricla1`+`nombre`+`nit` |
| `proveedor_tercero` | maestro comercial POS que usa el QR: `empresa`+`codigo`+`sucursal`+`nombre`+`nit` |
| `proveedor_sede_qr` | token opaco por sede → URL pública `/proveedores/ingreso/[token]` |
| `qr_calle_5ta` … `qr_chia` | marcaciones físicas por sede (entrada/salida; abierta = `salida_at IS NULL`; `autorizacion_datos_at` = habeas data al entrar) |
| `proveedor_visitas` | **vista** solo lectura = `UNION ALL` de `qr_*` (la app no escribe aquí) |
| `proveedor_visitas_legacy` | respaldo post-split; no escribir desde la app |
| `ventas_proveedor_dia` | ventas agregadas por proveedor/día (no es el form de ingreso) |

Mapa sede → tabla en `src/lib/proveedores/qr-tables.ts` (whitelist; no interpolar sede cruda).

```bash
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260805_proveedores_visitas.sql
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260805_proveedores_visitas_pos_catalog.sql
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260811_proveedor_visitas_por_sede.sql
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260813_qr_visitas_autorizacion_datos.sql
```

### 4.y Proveedores (ventas e inventario desde el POS)

Migraciones: `db/migrations/20260805_ventas_proveedor.sql` y
`db/migrations/20260805_inventario_proveedor.sql`.
ETL: `scripts/etl/proveedores/etl_proveedores.py` (ver su
[README](../scripts/etl/proveedores/README.md)). Timers `visor-etl-proveedores*` a las 07:12.

| Tabla | Grano | Uso |
| --- | --- | --- |
| `proveedor_pos_catalogo` | empresa + id_cricla1 | maestro de **criterio del ítem** (~3.4k) con `nit`; el ETL nunca pisa un `nit_origen='manual'` |
| `proveedor_tercero` | empresa + codigo + sucursal | maestro **comercial** POS (`terceros.ind_pro=1`); distinto de `criterios_itm_1` |
| `proveedor_item` | empresa + id_item | puente item -> proveedor (~145k); sin el no se puede valorizar inventario |
| `ventas_proveedor_dia` | empresa + fecha + id_co + id_cricla1 | ventas: `unidades`, `venta_base`, `impuestos`, `venta_con_impuesto` |
| `inventario_proveedor_dia` | empresa + fecha_dia + id_co + id_cricla1 | inventario valorizado al costo, derivado de `rotacion_base_item_dia_sede` |

Notas que evitan errores de lectura:

- **`venta_base` es la base gravable (sin impuestos)**; `venta_con_impuesto` = `venta_base + impuestos`.
  Medido: `cmmovimiento_pdv.ven_netas = vlrtot_bru + imp_netos`, o sea que
  `ventas_item_diario.venta_sin_impuesto_dia` **si trae impuesto pese a su nombre**. El ranking de
  proveedores cambia segun cual se use.
- El “proveedor” de venta/inventario sale de `criterios_itm_1` del POS (no de `terceros`).
  Lo que no resuelve entra como `@SP` / `(SIN PROVEEDOR)` para que las sumas cuadren:
  1,3% de la venta, 0% del inventario. La lista comercial real vive en `proveedor_tercero`.
- El NIT sale de `nit_mmio` (mercamio) y `nit_mtodo` (mtodo); bogota lo hereda. Descarta el
  centinela `'99999999'` (750 de 1093 filas). Cobertura: 341 de 1137 criterios.
- Devoluciones (`id_tipdoc_fc LIKE 'Z%'`) se excluyen, igual que `ventas_item_diario`.

### 4.z Proveedores (productividad por familia)

No hay tabla nueva. `/api/proveedores/productividad` lee:

| Fuente | Métrica |
| --- | --- |
| `margen_item_dia_roll.cantidad` | Industria = unidades (N1 ≠ 01/02/03/12); Fruver = kilos (N1 `01`); Carnes = kilos (N1 `02`) |
| `proveedor_item` + `proveedor_pos_catalogo` | drill por proveedor |
| `ventas_cajas.consecutivo_doc` | transacciones (cajas) |
| `asistencia_horas.total_laborado_horas` | horas pagadas por familia (depto → línea); productividad = volumen ÷ horas |

Pollo (`03`) y asadero (`12` / `id_tipo=3`) quedan fuera de industria para no mezclar kilos como unidades. Las horas de depto pollo/asadero tampoco entran al ratio. Rango máximo 31 días. La UI pide primero `mode=board` (KPIs + sede + día, cache en memoria 45s) y después `mode=proveedores`.

```bash
python3 scripts/etl/proveedores/etl_proveedores.py --desde 20260701 --hasta 20260731
python3 scripts/etl/proveedores/etl_proveedores.py --reconciliar --days 30
bash scripts/etl/sync-local-to-gcp.sh --only proveedor_pos_catalogo --only proveedor_item \
  --only proveedor_tercero --only ventas_proveedor_dia --only inventario_proveedor_dia \
  --days 3 --verify
```

### 4.aa Ordenes de compra (incremental POS)

Migracion: `db/migrations/20260813_orden_compra.sql`.
ETL: `scripts/etl/orden-compra/etl_orden_compra.py` (ver su
[README](../scripts/etl/orden-compra/README.md)). Timer `visor-etl-orden-compra` a las **08:00**
(`run-daily.sh`: `--incremental` dias+abiertas + `$SYNC --only orden_compra --no-refresh`; el diario 07:50 no incluye OC). Tablero `/ordenes-compra`.

| Tabla | Grano | Uso |
| --- | --- | --- |
| `orden_compra` | empresa + id_co + tipdoc + documento_oc | cabecera OC: estado, confirmacion POS, cantidades pedidas/recibidas |
| `orden_compra_linea` | empresa + id_co + tipdoc + documento_oc + id_item + id_terc | linea: item + tercero real (quien trajo la mercancia) |

Notas:

- Origen OC: `cmmovimiento_ocompra` en 217 (`OC` comercial, `FR` fruver, `OM` mercaderista, `OS` SAC).
- Origen ET/EF: `cmmovimiento_inventario` en 217 (entrada `ind_es=1`, bodega `01`). Solo se escriben en `orden_compra_linea` (no en cabecera, para no mezclar el tablero de OC). Costos usa esos costos por encima de FR.
- Diario: dias de `fecha_dcto` que faltan hasta ayer + refresh de OC abiertas (`ind_estado <> 2`) ya en dest. No toca las cumplidas.
- Primera carga: `--mes-actual` / `--desde`. Backfill sucio: `--reemplazar --desde/--hasta`.
- Confirmacion del sistema: `usuario_conf` / `fecha_conf` / `hora_conf`. Recepcion: `cantidad` vs `cantidad_ent`.
- El SLA de 7 dias **no** se persiste. El tablero calcula `fecha_dcto + 7`; `fecha_entrega` es la promesa POS.
- Sync GCP: solo via `--only orden_compra --only orden_compra_linea` (upsert de las tablas locales). El diario 07:50 / reconcile no las tocan.
- El criterio POS (`proveedor_pos_catalogo`, p.ej. MERCAMIO FRUVER) no es el tercero. Los nombres reales salen de `orden_compra_linea` (POS 217, `cmmovimiento_ocompra.id_terc` + `terceros`).

```bash
python3 scripts/etl/orden-compra/etl_orden_compra.py --dry-run
python3 scripts/etl/orden-compra/etl_orden_compra.py
bash scripts/etl/sync-local-to-gcp.sh --only orden_compra --only orden_compra_linea --verify
```

### 4.ab Maestro comercial POS (`proveedor_tercero`)

Migracion: `db/migrations/20260813_proveedor_tercero.sql`.
ETL: `scripts/etl/proveedores/etl_proveedor_tercero.py`.
Timer: `visor-etl-proveedores` (07:12, segunda `ExecStart`) + sync diario 07:35 (`MODE=full`).

| Tabla | Grano | Uso |
| --- | --- | --- |
| `proveedor_tercero` | empresa + codigo + sucursal | lista comercial (`terceros.ind_pro=1`); NIT, sucursal, ultima compra |

Notas:

- Origen: `public.terceros` en 217 (mercamio / mtodo / bogota). Una tabla destino, no tres.
- No sustituye `proveedor_pos_catalogo` (`criterios_itm_1`, p.ej. MERCAMIO FRUVER).
- Default: solo proveedores (`ind_pro='1'`). `--todos` carga cualquier tercero con codigo.
- Centinela NIT `99999999` se guarda como NULL. Filas que salen del POS: `activo=false`.
- Sucursal vacia del POS se normaliza a `'00'` (alineado con OC `id_suc_terc`).

```bash
python3 scripts/etl/proveedores/etl_proveedor_tercero.py --dry-run
python3 scripts/etl/proveedores/etl_proveedor_tercero.py
bash scripts/etl/sync-local-to-gcp.sh --only proveedor_tercero --no-refresh --verify
```

### 4.ac Checklists (intentos de 20 minutos)

Migracion: `db/migrations/20260819_checklist_runs.sql`.

| Tabla | Uso |
| --- | --- |
| `checklist_run` | intento por sede/rol/mes (`actor_role`, `sede`, `period_year/month`, `answers`, `score_pct`, `duration_seconds`, `signature_png`); 20 min; 1 vez al mes; panel puede reabrir vencidos |
| `checklist_run_evidence` | foto por ítem (`run_id`, `item_key`) cuando la respuesta es P o NC |

```bash
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260819_checklist_runs.sql
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260819_checklist_run_workflow.sql
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260819_checklist_evidence.sql
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260819_rotacion_restock_surtido_foto.sql
```

### 4.ad Restock: foto de surtido

Migracion: `db/migrations/20260819_rotacion_restock_surtido_foto.sql`.

| Tabla | Uso |
| --- | --- |
| `rotacion_restock_surtido_foto` | PK `(empresa, sede_id, item)`; `foto_base64` (texto SQL-safe) + `mime` + `updated_by` |

La UI de rotacion (filtro restock, estado **surtido**) permite tomar/subir la foto en la fila. El listado GET no trae el binario; la vista previa pide el item. API: `/api/rotacion/restock-fotos`.

Actualizar este documento cuando cambien migraciones, tablas leidas, columnas
dinamicas, indices acordados en produccion o bases externas.
