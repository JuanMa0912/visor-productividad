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
| `special-role-features.ts` | capacidades por `special_roles` |
| `line-category-scope.ts` | alcance por `allowed_lines` (asadero → cat. `3`; fruver → linea N1 `01`) |
| `rate-limit.ts` | rate limit en memoria por IP |
| `export-utils.ts` | utilidades para exportar tablas/graficos |
| `agent-debug-log.ts` | logging opcional de depuracion en desarrollo |
| `messages.ts` | catalogo de mensajes UI |
| `path-labels.ts` | etiquetas legibles para rutas en presencia/accesos |
| `item-drilldown-links.ts` | links entre modulos manteniendo filtros |
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
| `proveedores/` | visitas QR (`qr_*` por sede), ventas, productividad und/kg/tx, OIPV asistencia (admin) |
| `productivity/` | ventana de fechas, cache disco y volumen de tarjetas Mix y Línea (`tx`/`und`/`kg`/`UND.Pollo`) |
| `checklists/` | catálogo de auditorías y scoring (bodega gerencial); subtablero `checklists` |
| `excel-dian/` | conexiones por empresa, consulta y flag publico de exportacion |
| `notion/` | cliente Notion y normalizacion del cronograma |
| `parse-user-agent.ts` | parser simple de User-Agent usado en accesos admin |
| `status.ts` | helpers de estado |

## `src/app/`

### Rutas UI

| Grupo | Rutas |
| --- | --- |
| Portal | `/`, `/login`, `/secciones`, `/tableros`, `/venta`, `/horario`, `/cuenta/contrasena`, `/cronograma` |
| Venta | `/ventas-x-item`, `/inventario-x-item`, `/analisis-de-inventario`, `/participacion-comercial`, `/proveedores`, `/proveedores/ingreso/[token]` (público), `/exp/precios-proveedor` (subtablero opt-in), `/ordenes-compra` (**solo admin**) |
| Producto | `/productividad`, `/productividad/cajas`, `/margenes`, `/informe-variacion`, `/rotacion`, `/kardex`, `/prediccion-pedidos` |
| Operacion | `/jornada-extendida`, `/ingresar-horarios`, `/horarios-comparar`, `/horarios`, `/horarios-guardados`, `/checklists`, `/checklists/[id]` |
| Admin | `/admin/usuarios`, `/admin/usuarios/accesos`, `/admin/usuarios/accesos/pormes`, `/admin/usuarios/accesos/en-linea`, `/admin/usuarios/uso-tableros`, `/admin/usuarios/auditoria`, `/admin/usuarios/descargas`, `/admin/usuarios/[id]/metricas` |
| Experimental | `/exp/efectividad-cajero` (solo admin); `/exp/precios-proveedor` vive en hub Venta con subtablero `precios-proveedor` |
| Otros | `/ExcelDian` (PascalCase historico de URL) |

### APIs

| Carpeta | Uso |
| --- | --- |
| `auth/*` | login, logout, me, cambio de password y heartbeat |
| `admin/users`, `admin/users/[id]`, `admin/users/[id]/metrics` | usuarios y metricas por usuario |
| `admin/login-logs`, `admin/login-failures`, `admin/audit`, `admin/exports`, `admin/user-presence`, `admin/uso-tableros` | accesos, fallos de login, auditoría admin, descargas, presencia y uso de tableros |
| `exports/log` | POST: registra metadatos de una descarga/export (auth; fire-and-forget desde cliente) |
| `admin/cache/flush` | POST (CSRF): vacía cache en memoria del proceso (informe + márgenes). GET: tamaño actual |
| `productivity` | productividad por linea; 1ª carga ~40d + payload compacto; histórico diferido; cache memoria `productivity:full-v2`/disco; tarjetas Mix y Línea muestran volumen (cajas=tx, industria=und, fruver/carnes/pollo=kg, asadero=UND.Pollo+unidades) y conservan `$` para Excel/PDF |
| `hourly-analysis` | analisis horario, cajeros, horas extra y presencia por franja |
| `margenes` | margen por producto/factura/cliente/vendedor/sede (`mode=drill|fact-*|cliente|cliente-facturas|vendedor|vendedor-facturas|sede`) |
| `informe-variacion` | informe MoM/YoY; fuente preferida `margen_item_dia_roll` (+ snapshot `informe_variacion_payload_std` scope `*`, recortado en servidor por sedes/línea); si el acumulado Excel aún no cierra, ofrece `proj-1-N` (run-rate hasta el corte con datos al `maxDate`); UI monta explorador bajo demanda |
| `rotacion` | rotacion e inventario con baja salida |
| `rotacion/cero-estados`, `rotacion/cero-estados/audit` | estado S.inventario y auditoria |
| `ui-state/tutorial` | tutorial interactivo visto por clave (GET/POST `?key=`) |
| `rotacion/tutorial` | alias legacy de tutorial Rotación |
| `ventas-x-item`, `ventas-x-item/v2` | ventas por item |
| `inventario-x-item`, `inventario-x-item/presets` | inventario y presets; **sin Dinastía** (empresa/sedes excluidas en catálogo y consultas) |
| `analisis-de-inventario` | días de inventario: `mode=meta|board|drill|heatmap|filters`; mes móvil vía `rotacion_*_periodo_std`; cache 5 min; alcance por sedes del usuario (orden `SEDE_ORDER`); filtros `empresas`, `sedes`, `lineas`, `sublineas`, `items`, `diMin` (DI días, respeta `metric`); mapa: clic en sede ordena filas por DI (menos→mayor); detalle por sede ordena DI asc por defecto |
| `participacion-comercial` | participación sede↔línea: `mode=meta|board|drill|matrix`; almacén + estructura; snapshot/periodo_std |
| `exp/precios-proveedor` | subtablero `precios-proveedor` (opt-in, no hereda de NULL): heatmap ítem×sede precio venta / **costo de entrada** (`rotacion_base_item_dia_sede.costo_uni_inventario`, no COGS); doble clic despliega proveedores/SKUs del mismo producto; default día anterior; rango = AVG diario; máx. 14 días |
| `ordenes-compra` | tablero **solo admin**: OC incremental (pendiente/incompleta/vencida SLA 7d/cumplida); diario 08:00 dias nuevos + abiertas |
| `proveedores/ingreso` | público: meta/catálogo (`proveedor_tercero` filtrado por empresa de la sede del QR) + lookup/entrada/salida; entrada exige autorización habeas data (`autorizacionDatos`) |
| `proveedores/visitas` | subtablero `proveedores`: QR asistencia (entrada/salida en tablas `qr_*` por sede) + listado/filtros/CSV + métricas; `mode=meta` con links QR solo si `proveedores_qr` (o admin; PNG en cliente) |
| `proveedores/ventas` | subtablero `proveedores`: rolling 30d (u otra ventana) desde `ventas_proveedor_dia`; gráficos (sede, top 10, día, concentración) |
| `proveedores/productividad` | subtablero `proveedores`: `mode=board` (KPIs/sede/día + volumen÷horas pagadas, cache 45s) + `mode=proveedores` (ranking); industria=und, fruver/carnes=kg, cajas=tx; máx. 31 días |
| `proveedores/oipv` | **solo admin**: cruce QR L–D + ventas + COGS mercancía (`margen_item_dia_roll` vía `proveedor_item`; no es cobro OIPV); columna **HL** = unidades ÷ 350; filtro `all|con_visita|visita_sin_venta|venta_sin_visita` |
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
| `PresenceHeartbeat.tsx` | ping de actividad a `/api/auth/heartbeat` cuando el usuario esta autenticado |
| `TopBar.tsx` | barra usada por la home de productividad |
| `portal/*` | top bar global, branding, footer, menu de usuario, toaster y tarjetas hub |
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
| `etl/orden-compra/etl_orden_compra.py` | OC incremental POS 217 → `orden_compra` (232): dias nuevos + abiertas; GCP via `$SYNC --only orden_compra` (no entra en el diario 07:50) |
| `apply-activity-log-migration.mjs` | apoyo historico para migracion de actividad |
| `playwright_smoke.py` | smoke E2E con dev server activo |
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
