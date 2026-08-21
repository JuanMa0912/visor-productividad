# Estructura del repositorio

Guia de ubicacion para codigo, rutas, scripts y pruebas. Para vision general,
permisos y entorno ver [`README.md`](../README.md). Para base de datos ver
[`DATABASE.md`](DATABASE.md). Para despliegue Linux ver
[`DEPLOYMENT.md`](DEPLOYMENT.md).

Estado de referencia: codigo versionado revisado el **2026-07-17**.

## Convenciones

| Tema | Regla |
| --- | --- |
| Imports | Alias `@/` hacia `src/` (`tsconfig.json`) |
| Paginas | `src/app/<ruta>/page.tsx` (App Router) |
| APIs | `src/app/api/<modulo>/route.ts` |
| Logica reutilizable | `src/lib/<dominio>/` o `src/features/<modulo>/` |
| UI compartida | `src/components/` |
| Auth cliente | `src/lib/auth/auth-context.tsx` |
| Borde HTTP | `src/proxy.ts` redirige paginas sin `vp_session`; las APIs validan por endpoint |

```text
src/app/<ruta>/page.tsx
  -> fetch("/api/...")
    -> src/app/api/<modulo>/route.ts
      -> src/lib/auth, src/lib/db, src/lib/shared/*
```

## Directorios raiz

| Ruta | Uso |
| --- | --- |
| `.github/` | workflow CI y plantilla de PR |
| `.agents/skills/` | skills locales para agentes; no son reglas Cursor |
| `db/` | esquema auth, migraciones y SQL operativo |
| `deploy/` | unidades systemd y runbooks de operacion |
| `docs/` | documentacion tecnica |
| `public/` | assets estaticos |
| `scripts/` | utilidades de dev, build, DB, admin, debug y limpieza |
| `src/app/` | rutas UI y route handlers |
| `src/components/` | componentes React reutilizables |
| `src/features/` | modulos con capa propia de repo/schema/hooks/tests |
| `src/lib/` | librerias compartidas de dominio, auth, DB e integraciones |

## `src/lib/`

Codigo compartido sin UI de pagina.

### `auth/`

| Archivo | Rol |
| --- | --- |
| `index.ts` | sesiones, cookies `vp_session`/`vp_csrf`, bcrypt, CSRF, IP auditada, permisos admin, heartbeat, `last_path` y `app_user_activity_log` |
| `types.ts` | tipos puros `AuthUser`, `AuthRole`, `AuthUserPublic` |
| `auth-context.tsx` | `AuthProvider`, `useAuth`, `useRequireAuth`, `usePermissions` |

### `db/`

| Archivo | Rol |
| --- | --- |
| `index.ts` | pool PostgreSQL via `pg`, lectura de `.env.local` y validacion temprana de `DB_PASSWORD`, `DB_PORT`, `DB_SCHEMA` |

### `shared/`

| Archivo | Rol |
| --- | --- |
| `constants.ts` | sedes, lineas y agrupaciones visibles |
| `calc.ts` | productividad, margen y calculos compartidos |
| `normalize.ts` | normalizacion de textos, sedes e IDs |
| `utils.ts` | helpers genericos como `cn` |
| `portal-sections.ts` | secciones UAID, subtableros, alias legacy y validacion de acceso |
| `venta-item-board.ts` | pestañas compartidas de Días de inventario / inventario por sede / ventas por ítem |
| `control-room-access.ts` | filtro de módulos de `/secciones`; mismas reglas que hubs `/venta`, `/productividad`, `/horario` |
| `special-role-features.ts` | capacidades por `special_roles` |
| `line-category-scope.ts` | alcance por `allowed_lines` (asadero → cat. `3`; fruver → linea N1 `01`) |
| `rate-limit.ts` | rate limit en memoria por IP |
| `export-utils.ts` | utilidades para exportar tablas/graficos |
| `agent-debug-log.ts` | logging opcional de depuracion en desarrollo |
| `messages.ts` | catalogo de mensajes UI |
| `path-labels.ts` | etiquetas legibles para rutas en presencia/accesos |
| `item-drilldown-links.ts` | links entre modulos manteniendo filtros |
| `uaid-brand.ts` | versión e identidad visual UAID 5.0 (login primero; shell después) |
| `uaid-logo.ts` | geometría de la marca UAID (cerebro en trazo) para header/favicon |
| `portal-permissions.test.ts` | tests de permisos seccion/subtablero/rotacion |

### Dominios

| Ruta | Rol |
| --- | --- |
| `horarios/` | planillas, franjas, presets de lunes, ocultamiento de cedulas y comparacion |
| `rotacion/` | campos base, dimensiones, fuentes y estados de cero rotacion/restock |
| `ventas/` | ventas por item y rangos de fechas |
| `inventario/` | inventario por item y presets |
| `analisis-inventario/` | días de inventario (DI und/valor), drill y heatmap |
| `participacion-comercial/` | mix/participación sede↔línea por almacén |
| `proveedores/` | visitas QR (`qr_*` por sede; UI: pestaña Asistencia + pestaña QR), ventas, inasistencia (personas = und÷350÷7), productividad und/kg/tx, OIPV asistencia (admin); filtro de línea industria/fruver/carnes; fechas ancladas al último día con datos |
| `productivity/` | ventana de fechas, cache disco y volumen de tarjetas Mix y Línea (`tx`/`und`/`kg`/`UND.Pollo`) |
| `checklists/` | catálogo (bodega + punto de venta); 20 min; 1 vez al mes por sede; roles encargado/revisor/panel; cruce revisor vs encargado |
| `excel-dian/` | conexiones por empresa, consulta y flag publico de exportacion |
| `notion/` | cliente Notion y normalizacion del cronograma |
| `parse-user-agent.ts` | parser simple de User-Agent usado en accesos admin |
| `status.ts` | helpers de estado |

## `src/app/`

### Rutas UI

| Grupo | Rutas |
| --- | --- |
| Portal | `/`, `/login`, `/secciones`, `/tableros`, `/venta`, `/horario`, `/cuenta/contrasena`, `/cronograma` |
| Venta | `/analisis-de-inventario`, `/inventario-x-item`, `/ventas-x-item` (mismo tablero, 3 pestañas; URLs propias), `/participacion-comercial`, `/proveedores`, `/proveedores/ingreso/[token]` (público), `/costos` (subtablero opt-in; `/exp/precios-proveedor` redirige), `/ordenes-compra` (subtablero opt-in) |
| Producto | `/productividad`, `/productividad/cajas`, `/margenes`, `/informe-variacion`, `/rotacion`, `/kardex`, `/prediccion-pedidos` |
| Operacion | `/jornada-extendida`, `/ingresar-horarios`, `/horarios-comparar`, `/horarios`, `/horarios-guardados`, `/checklists`, `/checklists/[id]`, `/checklists/panel` |
| Admin | `/admin/usuarios`, `/admin/usuarios/accesos`, `/admin/usuarios/accesos/pormes`, `/admin/usuarios/accesos/en-linea`, `/admin/usuarios/uso-tableros`, `/admin/usuarios/auditoria`, `/admin/usuarios/descargas`, `/admin/usuarios/[id]/metricas` |
| Experimental | `/exp/efectividad-cajero` (solo admin) |
| Otros | `/ExcelDian` (PascalCase historico de URL) |

### APIs

| Carpeta | Uso |
| --- | --- |
| `auth/*` | login, logout, me, cambio de password y heartbeat |
| `admin/users`, `admin/users/[id]`, `admin/users/[id]/metrics` | usuarios y metricas por usuario |
| `admin/login-logs`, `admin/login-failures`, `admin/audit`, `admin/exports`, `admin/user-presence`, `admin/uso-tableros` | accesos, fallos de login, auditoría admin, descargas, presencia y uso de tableros |
| `exports/log` | POST: registra metadatos de una descarga/export (auth; fire-and-forget desde cliente) |
| `admin/cache/flush` | POST (CSRF): vacía cache en memoria del proceso (informe + márgenes). GET: tamaño actual |
| `productivity` | productividad por linea; 1ª carga ~40d + payload compacto; histórico diferido; cache memoria `productivity:full-v4`/disco (`volumeSchema=4`); tarjetas Mix y Línea muestran volumen (cajas=tx, industria=und menos visitas QR del día/sede, fruver/carnes/pollo=kg, asadero=UND.Pollo+horas+Unidades+horas) y conservan `$` para Excel/PDF |
| `hourly-analysis` | analisis horario, cajeros, horas extra y presencia por franja |
| `margenes` | margen por producto/factura/cliente/vendedor/sede (`mode=drill|fact-*|cliente|cliente-facturas|vendedor|vendedor-facturas|sede`) |
| `informe-variacion` | informe de variacion; 4 pestañas: Reporte (empresa/sede, cortes Excel + YoY/MoM), Cortes (matriz sedes, mismos cortes + MTD, proyección 1→hoy aunque falten días y siguiente corte Excel), Comparativo (dos rangos libres **y la misma matriz entre sedes**), Ranking (un periodo, **MoM o YoY**, estructura y top N **editable** 5–200); filtros Compañía→ítem + empresa/proveedor; fuente `margen_item_dia_roll` + `margen_item_mes_roll` y snapshot `informe_variacion_payload_std` |
| `rotacion` | rotacion e inventario con baja salida; capitulos A-B-C, criticos (D+0+S) y sobrestock (32+ / 50+ dias de inventario); filtro CAT (multi); restock muestra conteo S.inventario (sin verificar / seguimiento / surtido); tabs Tabla/Grafico encima de filtros; Grafico precarga sedes Mercamio/Mercatodo/Merkmios (sin Dinastia, IDB) y filtra en cliente sedes/lineas/sublineas/items; cortes D/0/S, agrupacion sede/linea/sublinea/item; panel Resultado de gestion: barras mensuales por sede (plata/unidades) con filtros propios de sede y mes (`rotacion_gestion_semana_roll`) |
| `rotacion/gestion` | GET KPIs D+0+S de un rango (`start`/`end`/`sedeScope`) o `mode=trend` (series mensuales por sede desde el roll) |
| `rotacion/cero-estados`, `rotacion/cero-estados/audit` | estado S.inventario y auditoria |
| `rotacion/restock-fotos` | GET metadatos o foto base64; PUT foto de item restock ya surtido |
| `checklists/runs` | GET/POST intento: 20 min, rol encargado/revisor, 1/mes por sede, guardar respuestas, foto obligatoria en P/NC, firma al finalizar, desbloqueo y borrado desde panel |
| `checklists/panel` | GET listado mensual de sedes/puntajes/tiempo/responsable; `?runId=` detalle (respuestas, fotos, firma) para revisar; errores de esquema/SQL se devuelven en JSON |
| `portal/freshness` | GET último corte: `refreshed_at` de rotación/informe + stats de `asistencia_horas`; sello de `/secciones` |
| `rotacion/tutorial` | alias legacy de tutorial Rotación |
| `ventas-x-item`, `ventas-x-item/v2` | ventas por item |
| `inventario-x-item`, `inventario-x-item/presets` | inventario y presets; **sin Dinastía** (empresa/sedes excluidas en catálogo y consultas) |
| `analisis-de-inventario` | días de inventario: `mode=meta|board|drill|heatmap|filters`; mes móvil vía `rotacion_*_periodo_std`; cache 5 min; alcance por sedes del usuario (orden `SEDE_ORDER`); filtros `empresas`, `sedes`, `lineas`, `sublineas`, `items`, `diMin` (DI días, respeta `metric`); en nivel ítem muestra proveedor (`proveedor_item` + `proveedor_pos_catalogo`); mapa: clic en sede ordena filas por DI (menos→mayor); detalle por sede ordena DI asc por defecto. UI: pestaña del tablero compartido con `/inventario-x-item` y `/ventas-x-item` |
| `participacion-comercial` | participación sede↔línea: `mode=meta|board|drill|matrix`; almacén + estructura; snapshot/periodo_std |
| `costos` | tablero `/costos` (subtablero opt-in `precios-proveedor`; `/exp/precios-proveedor` redirige): heatmap ítem×sede; **costo de entrada = inventario ET/EF** (`cmmovimiento_inventario` en 217 → `orden_compra_linea` / `rotacion_salidas_dia`; si no hay ET/EF ese día, FR/OC); Mercatodo: ET tránsito + EF; precio venta no se toca; doble clic: $/kg, kilos y margen vendido; filtros multi-select (checks): empresa, sede (al menos una), línea, sublínea, ítem y proveedor; proveedor sin prefijo de empresa (Bogotá/Mercamio/Mercatodo); al expandir, el mismo nombre se agrupa en una fila y suma el costo; máx. 14 días |
| `ordenes-compra` | tablero opt-in (`ordenes-compra` en `allowed_subdashboards`): OC incremental (pendiente/incompleta/vencida SLA 7d/cumplida); diario 08:00 dias nuevos + abiertas; cumplimiento `diaDesde`–`diaHasta` (día del documento, vencidas fuera; cerradas 100% + abiertas/incompletas por qty) |
| `proveedores/ingreso` | público: meta/catálogo (`proveedor_tercero` filtrado por empresa de la sede del QR) + lookup/entrada/salida; entrada exige autorización habeas data (`autorizacionDatos`) |
| `proveedores/visitas` | subtablero `proveedores`: pestaña **Asistencia** (entrada/salida en `qr_*`, listado/filtros/CSV + métricas) y pestaña **QR** (links/PNG; solo `proveedores_qr` o admin); `mode=meta` con links QR |
| `proveedores/ventas` | subtablero `proveedores`: por defecto último día con datos (`ventas_proveedor_dia`); filtro `linea=industria\|fruver\|carnes` vía `margen_item_dia_roll`; inasistencia = und÷350÷7 (personas) |
| `proveedores/productividad` | subtablero `proveedores`: `mode=board` (KPIs/sede/día + volumen÷horas pagadas, cache 45s) + `mode=proveedores` (ranking); industria=und, fruver/carnes=kg, cajas=tx; máx. 31 días |
| `proveedores/oipv` | **solo admin**: cruce QR L–D + ventas + COGS mercancía (`margen_item_dia_roll` vía `proveedor_item`; no es cobro OIPV); columna **HL** = unidades ÷ 350; filtro `all|con_visita|visita_sin_venta|venta_sin_visita` |
| UI `proveedores` pestaña Inasistencia | misma fuente que ventas; **inasistencia** = personas-mes (und÷350÷7÷30); **valor** = venta neta del proveedor |
| `kardex/*` | detalle, lookups, resumenes y totales |
| `jornada-extendida/meta`, `jornada-extendida/alex-report`, `jornada-extendida/tipos-horario` | metadata, reporte Alex y tipos de horario |
| `ingresar-horarios/forms`, `ingresar-horarios/forms/[id]`, `ingresar-horarios/options`, `ingresar-horarios/people` | planillas y opciones |
| `horarios-comparar` | comparacion planilla vs asistencia |
| `cronograma` | Notion cronograma |
| `excel-dian/export` | export DIAN |
| `debug-agent-log` | depuracion solo fuera de produccion |

Handlers especialmente grandes: `api/hourly-analysis/route.ts`,
`api/productivity/route.ts` y `api/rotacion/route.ts`. Mantener cambios
acotados al dominio cuando se toquen.

## `src/components/`

| Ruta | Rol |
| --- | --- |
| `HourlyAnalysis.tsx` | analisis por hora embebido en productividad/jornada |
| `LineCard.tsx`, `LineComparisonTable.tsx`, `SelectionSummary.tsx` | tarjetas Mix y Línea (volumen + horas; sin ventas) y comparativos |
| `PresenceHeartbeat.tsx` | ping de uso real a `/api/auth/heartbeat`; a los 5 min sin clic/teclado/toque/navegacion cierra la sesion |
| `TopBar.tsx` | barra usada por la home de productividad |
| `portal/*` | top bar global, branding, footer, menu de usuario, toaster y tarjetas hub. En tableros, el atajo es el grid a `/secciones`; no hay "Volver a venta/productividad/horario". El botón Volver queda para flujos anidados (admin, checklists, kardex, horarios-guardados). |
| `portal/uaid-logo.tsx` | marca UAID (cerebro en trazo blanco) de la barra, favicon y encabezados de impresión |
| `portal/portal-control-room.tsx` | sala de control de `/secciones` (módulos con los mismos accesos que los hubs; sin preview `/dev`) |
| `portal/login-cinematic-*`, `login-brand-copy.tsx` | cerebro 3D UAID 5.0 en el panel izquierdo de login/auth |
| `productividad/*` | controles/skeleton/empty states de productividad |
| `hourly-analysis/*` | piezas del analisis horario |
| `cashier/EditorialTop5.tsx` | top de cajeros |
| `ui/*` | primitivos UI locales |
| `jornada-extendida/*` | paneles de tipos de horario |

Regla: si la logica no es visual, moverla a `src/lib/`, `src/features/` o al
handler correspondiente.

## `src/features/`

| Ruta | Rol |
| --- | --- |
| `productividad/` | hook de datos, tipos, formateadores, utilidades de fecha/sede y visualizaciones |
| `kardex/` | `repo`, `schema`, `types`, `hooks` y tests de rutas/repositorio |

Patron preferido para modulos que crecen: `features/<modulo>/{repo,schema,types}`
y APIs mas delgadas en `src/app/api/`.

## `db/`

| Ruta | Rol |
| --- | --- |
| `schema-auth.sql` | tablas base de auth/admin |
| `migrations/*.sql` | cambios incrementales en orden por fecha |
| `crear-usuario.sql`, `permisos-usuario.sql` | usuario PostgreSQL `produ` |
| `seed_sede_users.sql` | usuarios base por sede |
| `establecer-password.sql` | apoyo operativo de password |

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

## `scripts/`

| Script | Uso |
| --- | --- |
| `dev.mjs` | wrapper de `npm run dev`; en Windows mata Next dev previos del mismo repo |
| `build.mjs` | wrapper de build con heap heuristico, modo strict y standalone |
| `create-admin.js` | crear/actualizar admin desde `ADMIN_*` |
| `test-db.js`, `test-db-postgres.js` | pruebas de conexion |
| `apply-migration-file.mjs` | aplicar un SQL de `db/migrations/` |
| `etl/orden-compra/etl_orden_compra.py` | OC incremental POS 217 → `orden_compra` + `orden_compra_linea` (232): dias nuevos + abiertas; ET/EF desde `cmmovimiento_inventario` solo a lineas; GCP via `$SYNC --only orden_compra --only orden_compra_linea` (no entra en el diario 07:50) |
| `apply-activity-log-migration.mjs` | apoyo historico para migracion de actividad |
| `playwright_smoke.py` | smoke E2E con dev server activo |
| `extract-brain-glb.mjs`, `embed-brain-points.mjs` | recorte de corteza (GLB) → `public/models/brain-points.bin` y `brain-points.ts` |
| `cleanup-logs.sh` | limpieza de logs/sesiones para systemd |
| `benchmark-rotacion.mjs`, `debug-rotacion-items.mjs` | diagnostico rotacion |

## Tests

| Tipo | Ubicacion | Comando |
| --- | --- | --- |
| Unitarios | `src/**/*.test.ts` | `npm test` |
| Feature tests | `src/features/**/__tests__/*` | incluidos en `npm test` |
| Smoke E2E | `scripts/playwright_smoke.py` | `npm run test:e2e-smoke` |

Agregar tests co-localizados (`*.test.ts`) cuando se toque una regla facil de
romper: fechas, permisos, parsers, filtros, agregados `SUM/SUM` o normalizadores.

## Naming

| Tipo | Convencion preferida |
| --- | --- |
| Utilidades/config | `kebab-case.ts` |
| Hooks | `use-*.ts` o `use-*.tsx` |
| Tests | co-localizados con sufijo `.test.ts` |
| Rutas | `kebab-case` |
| Tipos de modulo | `types.ts` dentro del modulo |
| Constantes exportadas | `UPPER_SNAKE_CASE` |

Excepciones historicas conscientes:

- `src/app/ExcelDian/` conserva PascalCase porque cambiarlo rompe URLs guardadas.
- `src/components/` mezcla PascalCase y kebab-case; mantener consistencia dentro
  de cada subcarpeta nueva.
- `src/types.ts` contiene tipos de dominio importados como `@/types`; `src/types/*.d.ts`
  contiene declaraciones ambient.

## Mantenimiento

Actualizar este archivo cuando:

- se cree una carpeta relevante en `src/lib/`, `src/features/` o `src/app/api/`;
- se agregue o quite una ruta UI/API;
- se agregue una migracion;
- cambie un patron de auth, permisos, presencia, exportacion o build;
- un handler pase a ser punto central de un dominio.
