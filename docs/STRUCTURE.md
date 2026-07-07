# Estructura del repositorio

Guia de ubicacion para codigo, rutas, scripts y pruebas. Para vision general,
permisos y entorno ver [`README.md`](../README.md). Para base de datos ver
[`DATABASE.md`](DATABASE.md). Para despliegue Linux ver
[`DEPLOYMENT.md`](DEPLOYMENT.md).

Estado de referencia: codigo versionado revisado el **2026-06-10**.

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
| `excel-dian/` | conexiones por empresa, consulta y flag publico de exportacion |
| `notion/` | cliente Notion y normalizacion del cronograma |
| `parse-user-agent.ts` | parser simple de User-Agent usado en accesos admin |
| `status.ts` | helpers de estado |

## `src/app/`

### Rutas UI

| Grupo | Rutas |
| --- | --- |
| Portal | `/`, `/login`, `/secciones`, `/tableros`, `/venta`, `/horario`, `/cuenta/contrasena`, `/cronograma` |
| Venta | `/ventas-x-item`, `/inventario-x-item`, `/analisis-de-inventario` |
| Producto | `/productividad`, `/productividad/cajas`, `/margenes`, `/informe-variacion`, `/rotacion`, `/kardex`, `/prediccion-pedidos` |
| Operacion | `/jornada-extendida`, `/ingresar-horarios`, `/horarios-comparar`, `/horarios`, `/horarios-guardados` |
| Admin | `/admin/usuarios`, `/admin/usuarios/accesos`, `/admin/usuarios/accesos/pormes`, `/admin/usuarios/accesos/en-linea`, `/admin/usuarios/uso-tableros`, `/admin/usuarios/[id]/metricas` |
| Otros | `/ExcelDian` (PascalCase historico de URL) |

### APIs

| Carpeta | Uso |
| --- | --- |
| `auth/*` | login, logout, me, cambio de password y heartbeat |
| `admin/users`, `admin/users/[id]`, `admin/users/[id]/metrics` | usuarios y metricas por usuario |
| `admin/login-logs`, `admin/user-presence`, `admin/uso-tableros` | accesos, presencia y uso de tableros |
| `productivity` | productividad por linea con cache de archivo opcional |
| `hourly-analysis` | analisis horario, cajeros, horas extra y presencia por franja |
| `margenes` | margen por linea/sede |
| `informe-variacion` | informe MoM/YoY agregado desde `margen_final` (`GET`, `GET /meta`) |
| `rotacion` | rotacion e inventario con baja salida |
| `rotacion/cero-estados`, `rotacion/cero-estados/audit` | estado S.inventario y auditoria |
| `ui-state/tutorial` | tutorial interactivo visto por clave (GET/POST `?key=`) |
| `rotacion/tutorial` | alias legacy de tutorial Rotación |
| `ventas-x-item`, `ventas-x-item/v2` | ventas por item |
| `inventario-x-item`, `inventario-x-item/presets` | inventario y presets |
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
| `LineCard.tsx`, `LineComparisonTable.tsx`, `SelectionSummary.tsx` | productividad y comparativos |
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
