# Estructura del repositorio

Guía de **dónde va cada cosa** en el código. Para visión de producto, APIs, permisos y despliegue, ver [`README.md`](../README.md) en la raíz. Para tablas PostgreSQL, índices y operación de BD, ver [`DATABASE.md`](DATABASE.md).

## Convenciones

| Tema | Regla |
| --- | --- |
| Imports | Alias `@/` → `src/` (`tsconfig.json`) |
| APIs | Un handler por carpeta: `src/app/api/<modulo>/route.ts` |
| Páginas | `src/app/<ruta>/page.tsx` (App Router de Next.js) |
| Lógica reutilizable | `src/lib/<dominio>/` o `src/features/<modulo>/` |
| UI compartida | `src/components/` |
| Cliente vs servidor | La mayoría de pantallas usan `"use client"`; la auth fina vive en cada API |
| Borde HTTP | `src/proxy.ts` redirige a `/login` sin cookie `vp_session` (no sustituye validación en APIs) |

```text
src/app/<ruta>/page.tsx     →  fetch("/api/...")
src/app/api/<modulo>/route.ts  →  @/lib/auth, @/lib/db, @/lib/...
```

---

## `src/lib/` — dominio y utilidades

Código compartido sin UI. Punto de entrada habitual: `index.ts` en `auth/` y `db/`.

### `auth/`

| Archivo | Rol |
| --- | --- |
| `index.ts` | Sesiones (`app_user_sessions`), cookie `vp_session`, hash de contraseña, `getClientIp`, `getAuditNetworkId`, `requireAuthSession`, `requireAdminSession` |

### `db/`

| Archivo | Rol |
| --- | --- |
| `index.ts` | Pool PostgreSQL (`pg`); exige `DB_PASSWORD` en entorno |

### `shared/`

| Archivo | Rol |
| --- | --- |
| `constants.ts` | Sedes, líneas de negocio, agrupaciones visibles |
| `calc.ts` | Productividad (Vta/Hr) y margen |
| `normalize.ts` | Normalización de textos, sedes, IDs |
| `utils.ts` | Helpers genéricos (`cn`, formatos) |
| `portal-sections.ts` | Secciones UAID (`venta`, `producto`, `operacion`), alias legacy, `canAccessSection` |
| `special-role-features.ts` | Capacidades por `special_roles` (`alex`, `cronograma`, ABCD, etc.) |
| `rate-limit.ts` | Límites por IP en memoria del proceso |
| `export-utils.ts` | Utilidades para exportar tablas/gráficos |
| `agent-debug-log.ts` | Logging opcional de depuración para agentes |

### `horarios/`

| Archivo | Rol |
| --- | --- |
| `ocultar-cedulas.ts` | Lista de cédulas ocultas en análisis por hora; admins las ven, el resto no (listas y conteo de presencia) |
| `schedule-time.ts` | Parseo y franjas horarias de marcaciones |
| `planilla-sede.ts` | Resolución sede ↔ asistencia |
| `planilla-persist.ts` | Persistencia de planillas guardadas |
| `comparar-utils.ts` | Lógica compartida de `/horarios-comparar` |
| `lunes-schedule-presets.ts` | Presets de horario los lunes |

**Consumidor principal de `ocultar-cedulas`:** `src/app/api/hourly-analysis/route.ts`.

### `rotacion/`

| Archivo | Rol |
| --- | --- |
| `base-fields.ts` | Campos SQL base de `rotacion_base_item_dia_sede` |
| `dimensions.ts` | Dimensiones de categoría / ABCD |
| `cero-estado.ts` | Estados de ítems con cero rotación (API y persistencia) |

**Lógica de clasificación UI (nuevo / restock / etc.):** `src/app/rotacion/rotacion-preamble.ts` (no está en `lib/rotacion` porque acoplada a la vista).

### `ventas/`

| Archivo | Rol |
| --- | --- |
| `x-item.ts` | Normalización y pivoteo ventas por ítem |
| `x-item-date-range.ts` | Validación de rangos de fechas (+ test) |

### `inventario/`

| Archivo | Rol |
| --- | --- |
| `x-item.ts` | Etiquetas y pivotes inventario por ítem |
| `x-item-presets.ts` | Presets de usuario (`inventario_x_item_user_presets`) |

### `excel-dian/`

| Archivo | Rol |
| --- | --- |
| `excel-dian-db.ts` | Conexiones PostgreSQL por empresa (MTDO / MIO / BGT) |
| `mtodo-medios-magneticos.ts` | Consultas y formato export DIAN |
| `public-export-env.ts` | Flag `EXCEL_DIAN_EXPORT_PUBLIC` / acceso sin sesión |

**UI:** `src/app/ExcelDian/`. **API:** `src/app/api/excel-dian/export/route.ts`.

### Raíz de `lib/`

| Archivo | Rol |
| --- | --- |
| `parse-user-agent.ts` | Etiqueta legible de User-Agent (navegador, versión, SO) |
| `parse-user-agent.test.ts` | Tests del parser |

**Consumidor:** `src/app/admin/usuarios/accesos/page.tsx`.

---

## `src/app/` — rutas y APIs

### Páginas por sección UAID

| Sección | Rutas UI notables |
| --- | --- |
| Portal | `/login`, `/secciones`, `/tableros` (redirect), `/venta`, `/horario`, `/cuenta/contrasena` |
| Venta | `/ventas-x-item`, `/inventario-x-item`, `/analisis-de-inventario` |
| Producto | `/`, `/productividad`, `/productividad/cajas`, `/margenes`, `/rotacion`, `/kardex`, `/prediccion-pedidos` |
| Operación | `/jornada-extendida`, `/ingresar-horarios`, `/horarios-comparar`, `/horarios`, `/horarios-guardados` |
| Admin | `/admin/usuarios`, `/admin/usuarios/accesos`, `/admin/usuarios/accesos/pormes` |
| Otros | `/ExcelDian` |

### APIs (`src/app/api/`)

| Carpeta | Uso |
| --- | --- |
| `auth/*` | Login, logout, me, cambio de contraseña |
| `admin/users`, `admin/login-logs` | CRUD usuarios y bitácora de accesos |
| `productivity` | Productividad por línea (cache en archivo) |
| `hourly-analysis` | Análisis por hora, cajeros, horas extra, presencia por franja |
| `margenes` | Márgenes por línea/sede |
| `rotacion`, `rotacion/cero-estados/*` | Rotación e ítems cero |
| `ventas-x-item`, `ventas-x-item/v2` | Ventas por ítem |
| `inventario-x-item`, `.../presets` | Inventario por ítem y presets |
| `kardex/*` | Detalle, resúmenes, totales, lookups |
| `jornada-extendida/meta`, `.../alex-report` | Metadatos y reporte Alex |
| `ingresar-horarios/*` | Formularios y opciones de horarios |
| `horarios-comparar` | Comparación de planillas |
| `excel-dian/export` | Export Excel DIAN |
| `debug-agent-log` | Depuración (restringir en producción) |

Handlers grandes (mantener cambios acotados al dominio):

- `api/hourly-analysis/route.ts`
- `api/productivity/route.ts`
- `api/rotacion/route.ts`

### `src/app/rotacion/` (módulo pesado en UI)

| Archivo | Rol |
| --- | --- |
| `page.tsx` | Vista principal (cliente), tablas, filtros, exportaciones |
| `rotacion-preamble.ts` | Tipos, constantes, reglas puras (nuevo, restock por ingreso en período, ABCD, etc.) |
| `rotation-filter-widgets.tsx` | Widgets de filtro reutilizables |

### `src/app/ingresar-horarios/`

| Archivo | Rol |
| --- | --- |
| `page.tsx` | Shell de la ruta |
| `ingresar-horarios-inner.tsx` | Formulario y estado principal (archivo grande) |

### `src/app/admin/usuarios/`

| Archivo | Rol |
| --- | --- |
| `page.tsx` | Listado y edición de usuarios |
| `accesos/page.tsx` | Bitácora de login (IP, navegador parseado) |
| `accesos/pormes/page.tsx` | Resumen de accesos por mes |
| `layout.tsx` | Layout protegido admin |

---

## `src/components/`

Componentes React reutilizables entre páginas.

| Ruta | Rol |
| --- | --- |
| `HourlyAnalysis.tsx` | Análisis por hora embebido en productividad/jornada (filtros, mapa, cajeros paginados, horas extra) |
| `LineCard.tsx`, `LineComparisonTable.tsx`, `SelectionSummary.tsx` | Productividad / comparativos |
| `TopBar.tsx` | Barra superior común |
| `portal/portal-branding-header.tsx` | Cabecera UAID, cuenta, navegación |
| `portal/hub-section-cards.tsx` | Tarjetas de hubs (`/venta`, etc.) |
| `productividad/*` | Skeleton, búsqueda, toggle de vista, empty state |
| `ui/*` | Primitivos (button, card, table, select, badge) |

**Regla:** lógica de negocio que no sea puramente visual → mover a `src/lib/` o al `route.ts` de la API.

---

## `src/features/`

Módulos con capa explícita (hoy solo kardex):

| Ruta | Rol |
| --- | --- |
| `kardex/repo.ts` | Consultas SQL / agregaciones |
| `kardex/schema.ts` | Validación Zod de query params |
| `kardex/types.ts` | Tipos de respuesta |
| `kardex/hooks.ts` | Hooks cliente (si aplica) |
| `kardex/__tests__/*` | Tests de repo y rutas |

Patrón a replicar si un módulo crece mucho: `features/<modulo>/{repo,schema,types}` + APIs delgadas en `app/api/`.

---

## `db/` — esquema y migraciones

Detalle de tablas, índices, dominios y consultas operativas: **[`DATABASE.md`](DATABASE.md)**.

| Ruta | Rol |
| --- | --- |
| `schema-auth.sql` | Tablas `app_users`, sesiones, login logs (base) |
| `migrations/*.sql` | Cambios incrementales (aplicar en orden por fecha en el nombre) |
| `crear-usuario.sql`, `permisos-usuario.sql` | Usuario PostgreSQL `produ` |
| `seed_sede_users.sql` | Usuarios de ejemplo por sede |
| `establecer-password.sql` | Soporte operativo de passwords |

### Orden de migraciones (después de `schema-auth.sql`)

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

Tablas de negocio (`ventas_*`, `asistencia_horas`, `rotacion_base_item_dia_sede`, etc.) suelen existir **antes** en el servidor; las migraciones del repo cubren auth, índices y extensiones de la app.

---

## `scripts/`

| Script | Uso |
| --- | --- |
| `dev.mjs` | `npm run dev` |
| `build.mjs` | `npm run build` / `build:server` |
| `create-admin.js` | Crear o actualizar admin (`ADMIN_*`, `DB_PASSWORD`) |
| `test-db.js`, `test-db-postgres.js` | Probar conexión y tablas |
| `playwright_smoke.py` | Smoke E2E (`npm run test:e2e-smoke`) |
| `benchmark-rotacion.mjs`, `debug-rotacion-items.mjs` | Diagnóstico rotación |

---

## Tests

| Tipo | Ubicación | Comando |
| --- | --- | --- |
| Unitarios | `src/**/*.test.ts` | `npm test` / `npm run test:unit` |
| Features | `src/features/**/__tests__/*` | Incluidos en `test:unit` |
| Smoke E2E | `scripts/playwright_smoke.py` | `npm run test:e2e-smoke` (dev server en marcha) |

Añadir un `*.test.ts` junto al módulo cuando la regla sea fácil de romper (fechas, parsers, agregados SUM/SUM).

---

## Otros directorios

| Ruta | Rol |
| --- | --- |
| `public/` | Assets estáticos |
| `docs/reference/` | PDF y material de referencia (no runtime) |
| `.agents/skills/` | Guías para agentes de desarrollo |
| `.github/workflows/ci.yml` | lint → typecheck → test → build |

---

## Cuándo actualizar este archivo

Actualizar `docs/STRUCTURE.md` cuando:

- se cree una carpeta nueva en `src/lib/`, `src/features/` o un módulo API relevante;
- se mueva lógica entre `page.tsx`, `lib/` y `api/`;
- se añada una migración en `db/migrations/`;
- un handler pase a ser “punto central” de un dominio (mencionarlo en la tabla de APIs).

No duplicar aquí tablas de permisos ni variables de entorno: enlazar al [`README.md`](../README.md).

*Referencia de código: mayo 2026.*
