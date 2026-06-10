# Visor de Productividad

Documento tecnico principal del repositorio. La aplicacion es un portal interno
Next.js para la UAID de Mercamio, Mercatodo y Merkmios, con PostgreSQL como
fuente principal de datos operativos, comerciales y administrativos.

Estado de referencia: codigo versionado revisado el **2026-06-10**.

## 1. Mapa rapido

| Documento | Uso |
| --- | --- |
| `README.md` | Vision general, modulos, permisos, entorno y operacion local |
| `docs/STRUCTURE.md` | Donde vive cada pieza de codigo, rutas UI/API, tests y convenciones |
| `docs/DATABASE.md` | Tablas, migraciones, indices y operacion PostgreSQL |
| `docs/DEPLOYMENT.md` | Runbook de despliegue Linux, HTTPS/HTTP, build y limpieza de logs |
| `deploy/README.md` | Instalacion y operacion del timer `cleanup-logs` |
| `AGENTS.md` | Instrucciones canonicas para agentes de codigo |
| `CONTRIBUTING.md` | Flujo de setup, validacion y PR |

## 2. Resumen del sistema

### Objetivo

Centralizar el Portal UAID con acceso por secciones, permisos por usuario,
consultas SQL directas, exportaciones de oficina y herramientas internas de
seguimiento operativo.

### Modulos activos

| Modulo | Rutas UI | APIs clave | Salidas principales |
| --- | --- | --- | --- |
| Portal UAID | `/secciones`, `/tableros` (redirect), `/login`, `/cuenta/contrasena` | `/api/auth/*` | entrada central, sesion, cuenta y permisos |
| Hub Venta UAID | `/venta` | - | acceso agrupado a ventas e inventario |
| Productividad | `/`, `/productividad`, `/productividad/cajas` | `/api/productivity`, `/api/hourly-analysis` | ventas, horas, comparativos, CSV/XLSX/PDF/PNG |
| Margenes | `/margenes` | `/api/margenes` | rentabilidad por linea y sede |
| Rotacion | `/rotacion`, `/rotacion-dos` | `/api/rotacion`, `/api/rotacion-dos`, `/api/rotacion/cero-estados*` | inventario, rotacion, ABCD, estados de S.inventario y auditoria |
| Kardex de margen | `/kardex` | `/api/kardex/*` | detalle diario y resumenes con margen `SUM/SUM` |
| Inventario x item | `/inventario-x-item` | `/api/inventario-x-item`, `/api/inventario-x-item/presets` | matrices, pivotes y presets por usuario |
| Ventas x item | `/ventas-x-item` | `/api/ventas-x-item`, `/api/ventas-x-item/v2` | analisis por item, meta/summary/options y XLSX |
| Horario y operacion | `/horario`, `/jornada-extendida`, `/ingresar-horarios`, `/horarios-comparar`, `/horarios`, `/horarios-guardados` | `/api/jornada-extendida/*`, `/api/ingresar-horarios/*`, `/api/horarios-comparar`, `/api/hourly-analysis` | consultas operativas, reporte Alex, planillas y comparativos |
| Cronograma | `/cronograma` | `/api/cronograma` | lectura de bases de datos embebidas en una pagina de Notion |
| Excel DIAN | `/ExcelDian` | `/api/excel-dian/export` | exportes DIAN por empresa desde bases PostgreSQL separadas |
| Administracion | `/admin/usuarios`, `/admin/usuarios/accesos`, `/admin/usuarios/accesos/pormes`, `/admin/usuarios/[id]/metricas` | `/api/admin/*`, `/api/auth/heartbeat` | usuarios, permisos, presencia, login logs y metricas de actividad |

### Secciones UAID

La definicion canonica esta en `src/lib/shared/portal-sections.ts`.

| Seccion | Ruta hub | Subtableros principales |
| --- | --- | --- |
| `venta` | `/venta` | `ventas-x-item`, `inventario-x-item`, `analisis-de-inventario` |
| `producto` | `/productividad` | `mix-y-linea`, `margenes`, `rotacion` |
| `operacion` | `/horario` | `consulta-operativa`, `planilla-vs-asistencia`, `registro-de-horarios` |

`/tableros` existe solo como ruta legacy hacia `/secciones`. El termino
"tablero" se mantiene por compatibilidad de base de datos y lenguaje historico.

## 3. Stack y arquitectura

| Capa | Tecnologia |
| --- | --- |
| Framework | Next.js `16.2.x` con App Router |
| UI | React `19.2.3`, Tailwind CSS `4`, Radix UI, componentes locales y MUI X Charts |
| Lenguaje | TypeScript |
| Persistencia | PostgreSQL via `pg`, sin ORM |
| Auth | Sesiones propias en BD + cookie `vp_session` + cookie CSRF `vp_csrf` |
| Validacion | Zod en endpoints que lo requieren |
| Exportacion | ExcelJS, jsPDF, jsPDF AutoTable, `html-to-image` |
| Integraciones externas | Notion SDK para `/cronograma`; PostgreSQL por empresa para Excel DIAN |

Flujo general:

```text
Usuario
  -> paginas en src/app
    -> fetch a /api/*
      -> route handlers Next.js
        -> src/lib/auth, src/lib/db, src/lib/shared/*
        -> PostgreSQL / Notion segun dominio
```

Piezas compartidas principales:

- `src/lib/auth/index.ts`: sesiones, cookies, CSRF, permisos de rol, auditoria de IP, heartbeat y actividad.
- `src/lib/db/index.ts`: pool PostgreSQL y carga de `.env.local` cuando aplica.
- `src/lib/shared/portal-sections.ts`: secciones, subtableros, alias legacy y normalizacion de permisos.
- `src/lib/shared/special-role-features.ts`: capacidades por `special_roles`.
- `src/lib/shared/rate-limit.ts`: rate limits en memoria por IP.
- `src/features/productividad/*`: hooks, tipos, formatters y visualizaciones del modulo de productividad.
- `src/features/kardex/*`: repo/schema/types/tests para Kardex.

## 4. Seguridad, sesiones y permisos

### Autenticacion

1. `POST /api/auth/login` valida `app_users`, `password_hash`, estado activo y credenciales.
2. Se revocan sesiones previas del usuario y se crea una nueva fila en `app_user_sessions`.
3. Se registra login en `app_user_login_logs` con IP auditada y User-Agent.
4. La UI consulta `GET /api/auth/me`; los endpoints protegidos usan `requireAuthSession` o `requireAdminSession`.
5. `POST /api/auth/heartbeat` refresca sesion, actualiza `last_activity_at`, guarda `last_path` e inserta actividad en `app_user_activity_log`.

### Cookies

| Cookie | Uso | Propiedades |
| --- | --- | --- |
| `vp_session` | token de sesion | `httpOnly`, `sameSite=lax`, `secure` segun `SESSION_COOKIE_SECURE` o `NODE_ENV=production`, expiracion deslizante de 60 minutos |
| `vp_csrf` | token CSRF para mutaciones protegidas | legible por cliente, `sameSite=lax`, `secure` igual que la sesion |

En despliegues HTTP planos se debe usar `SESSION_COOKIE_SECURE=false`; al pasar a
HTTPS se debe remover esa excepcion o establecer `true`. Ver
`docs/DEPLOYMENT.md`.

### Modelo de permisos

| Campo | Significado |
| --- | --- |
| `role` | `admin` o `user`; admin omite restricciones funcionales |
| `allowed_sedes` | sedes visibles; `NULL` o lista vacia normalizada equivale a todas |
| `allowed_lines` | lineas visibles; `NULL` equivale a todas |
| `allowed_dashboards` | secciones UAID (`venta`, `producto`, `operacion`); `NULL` equivale a todas |
| `allowed_subdashboards` | permisos granulares por subtablero; `NULL` equivale a todos |
| `special_roles` | capacidades especiales: `cronograma`, `alex`, `replicar_lunes`, `rotacion` legacy, `comparar_horarios`, `abcd`, `historial_sinventario`, `crear_horario_predeterminado` |
| `sede` | campo legacy usado como fallback |
| `is_active` | bloqueo o habilitacion de acceso |

Reglas notables:

- `src/proxy.ts` solo redirige paginas sin cookie hacia `/login`; no reemplaza la autorizacion por endpoint.
- `/cronograma` se muestra en UI a usuarios con `special_roles` que incluya `cronograma`.
- `/api/jornada-extendida/alex-report` requiere seccion `operacion` y rol especial `alex`, salvo admin.
- `/rotacion-dos` es una vista tecnica/admin sobre `rotacion_v4`.
- Los subtableros mandan sobre roles legacy cuando ambos datos estan disponibles.

### Headers y rate limiting

`next.config.ts` aplica CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`,
COOP/CORP, `Referrer-Policy` y `Permissions-Policy`.

Los rate limits estan en memoria del proceso. No son compartidos entre replicas.
Algunos limites explicitos:

| Endpoint | Limite |
| --- | --- |
| APIs con default `checkRateLimit` | 120 req/min/IP |
| `/api/ventas-x-item` | 90 req/min/IP |
| `/api/excel-dian/export` | 12 req/5 min/IP |
| `/api/admin/users` GET/POST | 60 req/min/IP / 20 req/min/IP |
| `/api/admin/users/[id]` PATCH/DELETE | 20 req/min/IP / 15 req/min/IP |
| `/api/admin/user-presence` | 240 req/min/IP |
| `/api/admin/users/[id]/metrics` | 60 req/min/IP |
| `/api/admin/login-logs` GET/DELETE | 60 req/min/IP / 10 req/min/IP |
| `/api/auth/login` | limites propios por IP auditada y usuario |

## 5. Datos, dominios e integraciones

### PostgreSQL principal

Dominios principales:

| Dominio | Tablas principales |
| --- | --- |
| Auth/admin | `app_users`, `app_user_sessions`, `app_user_login_logs`, `app_user_activity_log` |
| Productividad | `ventas_cajas`, `ventas_fruver`, `ventas_industria`, `ventas_carnes`, `ventas_pollo_pesc`, `ventas_asadero`, `asistencia_horas` |
| Margenes | `margenes_linea_co_dia` |
| Ventas x item | `ventas_item_diario`, `ventas_item_cargas`, `ventas_item_sede_map` |
| Rotacion/inventario/kardex | `rotacion_base_item_dia_sede`, `rotacion_v4`, `rotacion_abcd_config*`, `rotacion_cero_item_estado*` |
| Horarios | `horario_planillas`, `horario_planilla_detalles` |
| Inventario presets | `inventario_x_item_user_presets` |

El repo no contiene todo el DDL de tablas ETL como `ventas_*`,
`asistencia_horas`, `rotacion_base_item_dia_sede` o `margenes_linea_co_dia`.
Esas tablas suelen existir en el servidor y la app las lee.

### Notion

`/cronograma` usa `@notionhq/client` y lee bases de datos embebidas en una pagina
de Notion. Requiere:

- `NOTION_TOKEN`
- `NOTION_CRONOGRAMA_PAGE_ID`

La ruta requiere sesion valida; la visibilidad del enlace en el portal depende
de `special_roles` con `cronograma`.

### Excel DIAN

`/ExcelDian` y `/api/excel-dian/export` consultan bases PostgreSQL separadas por
empresa:

- `EXCEL_DIAN_MTDO_DB_*`
- `EXCEL_DIAN_MIO_DB_*`
- `EXCEL_DIAN_BGT_DB_*`

Por defecto requiere sesion. `EXCEL_DIAN_EXPORT_PUBLIC` o
`NEXT_PUBLIC_EXCEL_DIAN_EXPORT_PUBLIC` permiten exponerlo sin sesion en redes
confiables; tratarlo como excepcion operativa, no como default.

## 6. Operacion local

### Requisitos

- Node.js 22 recomendado (CI usa `actions/setup-node@v4` con Node 22).
- PostgreSQL accesible con tablas y migraciones aplicadas.
- Dependencias instaladas con `npm install` o `npm ci`.

### Setup rapido

```bash
npm install
cp .env.example .env.local
npm run db:test
node scripts/create-admin.js
npm run dev
```

En Windows, `npm run dev` usa `scripts/dev.mjs`: limpia procesos Next dev
anteriores del mismo proyecto, borra el lock local y levanta Next en un puerto
disponible (`--port 0`).

### Comandos

| Comando | Uso |
| --- | --- |
| `npm run dev` | servidor local Next |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript sin emitir archivos |
| `npm test` / `npm run test:unit` | tests `tsx --test "src/**/*.test.ts"` |
| `npm run test:e2e-smoke` | smoke Playwright/Python con dev server activo |
| `npm run build` | build rapido con wrapper de memoria |
| `npm run build:strict` | build con typecheck dentro de Next |
| `npm run build:server` | build standalone |
| `npm run build:release` | standalone + strict |
| `npm run start` | `next start` |
| `npm run start:server` | `.next/standalone/server.js` |
| `npm run ci` | lint + typecheck + test unitario + build |
| `npm run db:test` | prueba conexion y tablas desde `.env.local` |
| `npm run db:test:postgres` | valida conexion con usuario PostgreSQL |

### Variables de entorno principales

| Grupo | Variables |
| --- | --- |
| DB principal | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SCHEMA`, `DB_SSL` (scripts de limpieza) |
| Seguridad/sesion | `SESSION_COOKIE_SECURE`, `AUDIT_IP_HMAC_SECRET`, `TRUST_PROXY` |
| Runtime/build | `PRODUCTIVITY_CACHE_PATH`, `PRODUCTIVITY_SERVE_FILE_CACHE`, `NEXT_ENABLE_REACT_COMPILER`, `NEXT_BUILD_STANDALONE`, `NEXT_BUILD_STRICT`, `NEXT_BUILD_MEMORY_MB`, `NEXT_BUILD_LOG_LIMITS`, `NEXT_BUILD_SKIP_TYPECHECK`, `ALLOWED_DEV_ORIGINS`, `UPGRADE_INSECURE_REQUESTS`, `COOP_DISABLED`, `NEXT_PUBLIC_VENTAS_X_ITEM_USE_V2` |
| Excel DIAN | `EXCEL_DIAN_MTDO_DB_*`, `EXCEL_DIAN_MIO_DB_*`, `EXCEL_DIAN_BGT_DB_*`, `EXCEL_DIAN_EXPORT_PUBLIC`, `NEXT_PUBLIC_EXCEL_DIAN_EXPORT_PUBLIC` |
| Notion | `NOTION_TOKEN`, `NOTION_CRONOGRAMA_PAGE_ID` |
| Bootstrap admin | `ADMIN_USERNAME`, `ADMIN_PASSWORD` |

Nota: `CSP_UNSAFE_EVAL` aparece en entornos historicos, pero el CSP actual de
`next.config.ts` ya incluye `'unsafe-eval'` de forma fija para compatibilidad
con librerias de exportacion y UI. No depender de esa variable para cambiar CSP.

## 7. Migraciones

Orden recomendado despues de `db/schema-auth.sql`:

1. `db/migrations/20260203_auth_username.sql`
2. `db/migrations/20260220_user_sede.sql`
3. `db/migrations/20260224_user_allowed_lines.sql`
4. `db/migrations/20260227_user_allowed_dashboards.sql`
5. `db/migrations/20260302_user_allowed_sedes.sql`
6. `db/migrations/20260303_ventas_x_item.sql`
7. `db/migrations/20260305_user_special_roles.sql`
8. `db/migrations/20260409_ingresar_horarios.sql`
9. `db/migrations/20260423_rotacion_perf_indexes.sql`
10. `db/migrations/20260424_user_allowed_subdashboards.sql`
11. `db/migrations/20260427_rotacion_new_fields_indexes.sql`
12. `db/migrations/20260429_rotacion_cero_item_estado.sql`
13. `db/migrations/20260429_rotacion_cero_item_estado_values.sql`
14. `db/migrations/20260504_inventario_x_item_user_presets.sql`
15. `db/migrations/20260514_rotacion_cero_item_estado_restock_context.sql`
16. `db/migrations/20260515_rotacion_cero_item_estado_audit.sql`
17. `db/migrations/20260516_productividad_x_linea_indexes.sql`
18. `db/migrations/20260520_rotacion_v4_perf_indexes.sql`
19. `db/migrations/20260520_session_last_activity.sql`
20. `db/migrations/20260520_session_last_path.sql`
21. `db/migrations/20260526_user_activity_log.sql`
22. `db/migrations/20260529_ventas_x_item_perf_indexes.sql`
23. `db/migrations/20260603_rotacion_cero_item_estado_empresa.sql`

`scripts/apply-migration-file.mjs` aplica un SQL individual desde
`db/migrations/` usando `.env.local`.

## 8. CI y mantenimiento

`.github/workflows/ci.yml` corre en Pull Requests contra `main` y manualmente
por `workflow_dispatch`. No corre en cada push directo a `main`.

Pipeline:

1. `npm ci`
2. `npm run ci`

`npm run ci` expande a lint, typecheck, tests unitarios y build.

Actualizar esta documentacion cuando:

- se agregue o elimine una ruta UI/API;
- cambien permisos, sesiones, headers o cookies;
- cambien tablas, migraciones o variables de entorno;
- cambien despliegue, cache, exportaciones o integraciones externas;
- se agreguen scripts de desarrollo, build, DB o limpieza.
