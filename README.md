# Visor de Productividad

Documento tecnico compacto del repositorio, pensado para lectura directa o exportacion a PDF. La aplicacion es una web interna en Next.js para el Portal UAID de Mercamio, Mercatodo y Merkmios, usando PostgreSQL como fuente principal de datos para productividad, margenes, operacion y ventas por item.

## 1. Resumen del sistema

### Objetivo

Centralizar la experiencia del Portal UAID con acceso por secciones, filtros por permisos, consultas SQL directas y exportaciones a formatos de oficina.

### Modulos activos

| Modulo | Rutas UI | APIs clave | Salidas principales |
| --- | --- | --- | --- |
| Portal UAID | `/secciones` (`/tableros` redirige a `/secciones`) | `/api/auth/me` | entrada central por secciones; cuenta y sesion en la parte superior |
| Hub Venta UAID | `/venta` | — | acceso agrupado a ventas por item e inventario |
| Productividad | `/`, `/productividad`, `/productividad/cajas` | `/api/productivity`, `/api/hourly-analysis` | ventas, horas, comparativos; grafico multi-serie (filtros y top series); CSV, XLSX, PDF |
| Margenes | `/margenes` | `/api/margenes` | rentabilidad por linea y sede |
| Rotacion | `/rotacion` | `/api/rotacion` | inventario, rotacion y margen estimado por item/sede |
| Inventario x item | `/inventario-x-item` | `/api/inventario-x-item` | vistas y pivotes de inventario desde la base comun de rotacion |
| Analisis de inventario | `/analisis-de-inventario` | — | exploracion complementaria inventario vs venta |
| Prediccion pedidos | `/prediccion-pedidos` | — | modulo UI orientado a demanda (sin API REST de negocio dedicada listada aqui) |
| Ventas x item | `/ventas-x-item` | `/api/ventas-x-item`, `/api/ventas-x-item/v2` | analisis por item, modo `meta`/`summary`/paginacion y XLSX |
| Horario y operacion | `/horario`, `/jornada-extendida`, `/ingresar-horarios`, `/horarios-comparar`, `/horarios`, `/horarios-guardados` | `/api/jornada-extendida/meta`, `/api/jornada-extendida/alex-report`, `/api/hourly-analysis`, `/api/ingresar-horarios/options`, `/api/ingresar-horarios/forms`, `/api/horarios-comparar` | consultas operativas, reporte Alex y formularios de horarios |
| Administracion | `/admin/usuarios`, `/admin/usuarios/accesos`, `/cuenta/contrasena`, `/login` | `/api/auth/*`, `/api/admin/*` | login, sesiones, usuarios y permisos |

### Experiencia UAID actual

#### Login y entrada al portal

- `/login` usa la identidad `UAID` como marca principal.
- `Portal de Inteligencia de Datos` y `Unidad de Analitica e Inteligencia de Datos` funcionan como subtitulos institucionales.
- Al autenticarse correctamente, el usuario entra a `/secciones`.
- La ruta legacy `/tableros` se mantiene solo como redireccion a `/secciones`.

#### Secciones iniciales del portal

La definicion canónica de textos y modulos por seccion vive en `src/lib/portal-sections.ts`. Resumen:

| Seccion | Descripcion funcional | Modulos visibles en tarjetas | Ruta de entrada del hub |
| --- | --- | --- | --- |
| `Venta` | Lectura del resultado comercial e inventario asociado. | `Ventas por item`, `Inventario x item`, `Analisis de inventario` | `/venta` |
| `Producto` | Productividad, rentabilidad, rotacion y lecturas analiticas. | `Productividad`, `Margenes`, `Rotacion`, `Prediccion pedidos` | `/productividad` |
| `Operacion` | Horas, personal y registro de horarios. | `Horarios`, `Registro de horarios` | `/horario` |

#### Jerarquia visual documentada

- En el login, `UAID` debe tener mas peso visual que `Portal de Inteligencia de Datos`.
- En `/secciones`, el bloque **Cuenta** (cambio de usuario, contrasena, metadatos de sesion y ciclo) va **arriba** del texto introductorio y de las tarjetas de seccion; el **pie de pagina** es minimalista (version del portal y linea corta institucional).
- El tono general buscado es institucional, claro y amigable, sin romper la estructura actual de la app.

### Stack actual

- Framework: Next.js `16.1.2` con App Router.
- UI: React `19.2.3` + Tailwind CSS `4`.
- Componentes: Radix UI, componentes locales y MUI X Charts.
- Lenguaje: TypeScript.
- Persistencia: PostgreSQL via `pg`.
- Auth: sesiones propias en base de datos + cookie `vp_session`.
- Exportacion: ExcelJS, jsPDF, jsPDF AutoTable y canvas.
- Animacion: Anime.js.

## 2. Arquitectura

La aplicacion usa una arquitectura directa: las paginas cliente en `src/app` consumen endpoints internos en `src/app/api`, y cada `route.ts` consulta PostgreSQL sin ORM ni una capa intermedia de servicios o repositorios.

```text
Usuario
  -> paginas cliente en src/app
    -> fetch a /api/*
      -> route handlers Next.js
        -> src/lib/auth.ts
        -> src/lib/db.ts
        -> PostgreSQL

Exportaciones
  -> generadas en cliente
    -> XLSX / CSV / PDF / PNG
```

### Piezas compartidas

- `src/lib/auth.ts`: sesiones, cookies, hashing, permisos y auditoria de IP.
- `src/lib/db.ts`: inicializacion del pool de PostgreSQL.
- `src/lib/constants.ts`: sedes, lineas y agrupaciones visibles.
- `src/lib/calc.ts`: calculos de productividad y margen.
- `src/lib/portal-sections.ts`: secciones UAID, alias de rutas legacy y comprobacion de acceso por seccion.
- `src/lib/ventas-x-item.ts`: normalizacion y pivoteo para ventas x item.
- `src/lib/inventario-x-item.ts`: etiquetas y pivotes para inventario x item.
- `src/app/api/hourly-analysis/route.ts`: modulo mas cargado en transformacion, permisos y cache en memoria.

### Rasgos de implementacion

- Las vistas principales usan `"use client"`.
- No existe `middleware.ts`; la autorizacion se repite por endpoint.
- SQL, normalizaciones y shape de respuesta viven en los handlers.
- Hay mapeos manuales para sedes, empresas, centros de operacion y departamentos.
- Los caches actuales no son distribuidos:
  - `/api/productivity` usa archivo local JSON.
  - `/api/hourly-analysis` usa memoria del proceso.

## 3. Seguridad, sesiones y permisos

### Flujo de autenticacion

1. El usuario entra por `/login` y llama `POST /api/auth/login`.
2. El backend valida `app_users`, el `password_hash`, el estado del usuario y crea una sesion en `app_user_sessions`.
3. El login registra trazabilidad en `app_user_login_logs` y actualiza `last_login_at` y `last_login_ip`.
4. La UI consulta `GET /api/auth/me`; los endpoints protegidos usan `requireAuthSession` o `requireAdminSession`.

### Cookie de sesion

| Propiedad | Valor |
| --- | --- |
| Nombre | `vp_session` |
| Tipo | `httpOnly` |
| `sameSite` | `lax` |
| `secure` | depende de `SESSION_COOKIE_SECURE` o `NODE_ENV=production` |
| Expiracion | sesion deslizante, 60 minutos de inactividad |
| Revocacion | `logout` marca la sesion como revocada y expira la cookie |

### Modelo de permisos

- `role`: `admin` o `user`.
- `allowed_sedes`: controla sedes visibles; `NULL` o `Todas` equivale a acceso amplio.
- `allowed_lines`: restringe lineas; `NULL` equivale a todas.
- `allowed_dashboards`: columna legacy que ahora guarda secciones UAID (`venta`, `producto`, `operacion`); `NULL` equivale a todas.
- `special_roles`: uso principal `alex` (reporte Alex en jornada extendida); tambien `cronograma` para acceso al enlace de cronograma en cabeceras del portal cuando corresponda.
- `sede`: campo legacy usado como fallback cuando no hay `allowed_sedes`.
- `is_active`: habilita o bloquea el acceso.

Los valores legacy de `allowed_dashboards` siguen siendo compatibles. El mapeo de rutas y alias hacia `venta` / `producto` / `operacion` esta centralizado en `PORTAL_SECTION_ALIAS_MAP` dentro de `src/lib/portal-sections.ts` (algunas pantallas adicionalmente comprueban la seccion en codigo).

### Secciones y acceso

| Permiso | Rutas / APIs asociadas |
| --- | --- |
| `venta` | `/secciones`, `/venta`, `/ventas-x-item`, `/inventario-x-item`, `/analisis-de-inventario`, `/api/ventas-x-item`, `/api/ventas-x-item/v2`, `/api/inventario-x-item` |
| `producto` | `/secciones`, `/`, `/productividad`, `/productividad/cajas`, `/margenes`, `/rotacion`, `/prediccion-pedidos`, `/api/productivity`, `/api/margenes`, `/api/hourly-analysis`, `/api/rotacion` |
| `operacion` | `/secciones`, `/horario`, `/jornada-extendida`, `/ingresar-horarios`, `/horarios-comparar`, `/horarios`, `/horarios-guardados`, `/api/jornada-extendida/*`, `/api/ingresar-horarios/*`, `/api/horarios-comparar`, `/api/hourly-analysis` |
| `alex` | `special_roles` requerido para `/api/jornada-extendida/alex-report`, salvo admin |

Nota operativa: la home funcional ya no se organiza por "tableros" sino por secciones UAID. El termino "tablero" queda solo como compatibilidad de ruta o de almacenamiento legacy.

### Endpoints de soporte

| Endpoint | Metodo | Acceso | Uso |
| --- | --- | --- | --- |
| `/api/auth/login` | `POST` | publico | inicio de sesion |
| `/api/auth/me` | `GET` | sesion valida | usuario actual |
| `/api/auth/logout` | `POST` | sesion opcional | cierre de sesion |
| `/api/auth/change-password` | `POST` | sesion valida | cambio de contrasena |
| `/api/admin/users` | `GET`, `POST` | admin | listar y crear usuarios |
| `/api/admin/users/[id]` | `PATCH`, `DELETE` | admin | editar o eliminar usuarios |
| `/api/admin/login-logs` | `GET`, `DELETE` | admin | consultar o limpiar bitacora |

### Headers y rate limiting

`next.config.ts` aplica a todas las rutas: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Referrer-Policy` y `Permissions-Policy`.

| Endpoint | Limite observado |
| --- | --- |
| `/api/productivity` | 120 req/min/IP |
| `/api/hourly-analysis` | 120 req/min/IP |
| `/api/margenes` | 120 req/min/IP |
| `/api/ventas-x-item` | 90 req/min/IP |
| `/api/ventas-x-item/v2` | 120 req/min/IP |
| `/api/jornada-extendida/alex-report` | 60 req/min/IP |
| `/api/auth/login` | 10 intentos/15 min por IP auditada y 5 intentos/15 min por usuario |

### Limitaciones de seguridad actuales

- No hay `middleware.ts` para auth centralizada.
- Los rate limits viven en memoria del proceso y no se comparten entre replicas.
- No hay proceso documentado de limpieza de sesiones expiradas.

## 4. Datos, endpoints e integraciones

### Integraciones reales

La unica integracion de negocio observada en el codigo es PostgreSQL. No se encontraron APIs HTTP externas, colas, object storage ni proveedores externos de autenticacion.

### Tablas principales

| Dominio | Tablas |
| --- | --- |
| Auth y administracion | `app_users`, `app_user_sessions`, `app_user_login_logs` |
| Productividad y analisis horario | `ventas_cajas`, `ventas_fruver`, `ventas_industria`, `ventas_carnes`, `ventas_pollo_pesc`, `ventas_asadero`, `asistencia_horas` |
| Margenes | `margenes_linea_co_dia` |
| Ventas x item | `ventas_item_diario`, `ventas_item_cargas`, `ventas_item_sede_map` |
| Rotacion e inventario x item | `rotacion_base_item_dia_sede`, `rotacion_abcd_config` |

### Comportamiento por dominio

- `GET /api/productivity`
  - Consulta `ventas_*` y `asistencia_horas`.
  - Usa cache de archivo en `PRODUCTIVITY_CACHE_PATH`.
  - Si no hay cache y la DB falla, responde fallback vacio.
- `GET /api/hourly-analysis`
  - Consulta `ventas_*` y `asistencia_horas`.
  - Soporta `date`, `sede`, `line`, `bucketMinutes`, `includePeople`, `overtimeDateStart`, `overtimeDateEnd` y `dashboardContext`.
  - `bucketMinutes` acepta `60`, `30`, `20`, `15` y `10`.
  - Cachea respuesta 30 segundos y columnas de `asistencia_horas` 5 minutos en memoria.
  - Reutiliza logica entre productividad y jornada extendida.
- Vista `/` modo **Grafico** (productividad)
  - Comparativos multi-serie de `Vta/Hr`: por defecto el grafico puede limitar las lineas dibujadas a las series con mayor promedio en el rango seleccionado; la UI ofrece **Ver todas** para mostrar todas las combinaciones sede/linea seleccionadas.
  - Filtros de lineas y sedes del grafico incluyen busqueda textual; las exportaciones CSV/XLSX del grafico incluyen **todas** las series seleccionadas, no solo las visibles en pantalla.
- `GET /api/margenes`
  - Agrega directamente `margenes_linea_co_dia`.
  - Aplica filtro por lineas permitidas.
- `GET /api/jornada-extendida/meta`
  - Resuelve fechas disponibles y sedes visibles desde `asistencia_horas`.
- `GET /api/jornada-extendida/alex-report`
  - Usa `asistencia_horas`, requiere seccion `operacion` y rol `alex` o `admin`.
  - Limita el rango a 31 dias.
  - La metrica etiquetada en UI como **mas de ~7h20 con 2 marcaciones** solo cuenta filas donde exista al menos una marcacion del dia con estado **SI NOMINA** (columna `nomina` detectada dinamicamente); sin ese criterio no incrementa el contador aunque coincidan horas y numero de marcas.
  - En `/jornada-extendida`, la tabla visible se exporta a Excel en cliente con el rango seleccionado, columna `Sede` fija, fila total y solo las metricas marcadas en el selector.
  - La exportacion sanea texto antes de escribir celdas para evitar formulas inesperadas en Excel.
- `GET /api/rotacion`
  - Agrega inventario, ventas y rotacion por item/sede desde `rotacion_base_item_dia_sede` y reglas de clasificacion; el **margen monetario** se estima en SQL a partir de ventas, unidades e inventario (no depende de una columna `utilidad_bruta` en esa vista).
  - Permisos de acceso y edicion de configuracion ABCD pueden depender de `special_roles` ademas de la seccion `producto` (ver `src/lib/special-role-features.ts`).
- `GET /api/inventario-x-item`
  - Consulta principalmente `rotacion_base_item_dia_sede` para matrices y resumenes de inventario por empresa/sede/item.
- `GET /api/ventas-x-item`
  - Lee `ventas_item_diario`.
  - Maneja `meta`, `summary`, rango por fechas, empresa, item y paginacion.
  - Si no se envia rango, usa la ultima semana disponible en la tabla.
- `GET /api/ventas-x-item/v2`
  - Mantiene `meta` y `summary`.
  - Agrega `options`, `itemQuery`, `idCo` y `optionLimit`.
  - Si no se envia rango, usa la ultima semana disponible en la tabla.
  - La UI cambia entre v1 y v2 con `NEXT_PUBLIC_VENTAS_X_ITEM_USE_V2`.

### Parametros relevantes en ventas x item

| Parametro | v1 | v2 | Uso |
| --- | --- | --- | --- |
| `start`, `end` | si | si | rango de fechas |
| `mode` | si | si | `meta`, `summary`; v2 agrega `options` |
| `empresa` | si | si | filtro por empresa |
| `itemIds` | si | si | filtro por item |
| `itemQuery` | no | si | busqueda libre |
| `idCo` | no | si | filtro por centro de operacion |
| `maxRows`, `offset` | si | si | paginacion y limite |
| `optionLimit` | no | si | limite de opciones en modo `options` |

### Riesgos de integracion

- La app depende de mapeos manuales de sedes, empresas y departamentos.
- Cambios en columnas de `asistencia_horas` pueden romper deteccion dinamica.
- No hay documentacion del proceso de carga de `ventas_item_diario`.
- El ciclo de vida del cache `PRODUCTIVITY_CACHE_PATH` solo esta descrito en codigo.

## 5. Operacion local

### Requisitos

- Node.js compatible con Next.js 16.
- Dependencias instaladas con `npm install`.
- Acceso a PostgreSQL con tablas y migraciones aplicadas.

### Comandos

```bash
npm install
npm run dev
npm run lint
npm run build
npm run start
```

### Flujo recomendado

1. Configurar variables de entorno de base de datos y seguridad.
2. Aplicar `db/schema-auth.sql` y luego las migraciones.
3. Verificar conectividad con `node test-db.js` o `node test-db-postgres.js`.
4. Crear o actualizar un admin con `node scripts/create-admin.js` si hace falta.
5. Ejecutar `npm run dev`.

## 6. Entorno, base de datos y scripts

### Variables de entorno detectadas

El repo ya incluye `.env.example` con placeholders seguros. Las variables observadas en el codigo son:

| Grupo | Variables |
| --- | --- |
| DB | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SCHEMA` |
| Seguridad | `SESSION_COOKIE_SECURE`, `AUDIT_IP_HMAC_SECRET` |
| Runtime y cache | `PRODUCTIVITY_CACHE_PATH`, `NEXT_ENABLE_REACT_COMPILER`, `UPGRADE_INSECURE_REQUESTS`, `CSP_UNSAFE_EVAL`, `NEXT_PUBLIC_VENTAS_X_ITEM_USE_V2` |
| Bootstrap admin | `ADMIN_USERNAME`, `ADMIN_PASSWORD` |

### Defaults y advertencias

- `src/lib/db.ts` usa defaults de conexion: host `192.168.35.232`, puerto `5432`, base `produXdia`, usuario `postgres`, schema `public`.
- `src/lib/db.ts` ya no incluye password hardcodeado: requiere `DB_PASSWORD` en el entorno y falla temprano si no existe.
- `src/lib/db.ts` valida `DB_PORT` y `DB_SCHEMA` antes de abrir el pool.
- `scripts/create-admin.js` lee `.env.local` si existe y exige `DB_PASSWORD` antes de conectarse.
- `test-db.js` y `test-db-postgres.js` leen `.env.local` si existe y exigen `DB_PASSWORD`; ya no incluyen passwords embebidos.
- `.env.example` se puede usar como base para nuevos ambientes sin exponer secretos reales.

### Esquema y migraciones

Orden recomendado para reflejar el estado actual del codigo:

1. `db/schema-auth.sql`
2. `db/migrations/20260203_auth_username.sql`
3. `db/migrations/20260220_user_sede.sql`
4. `db/migrations/20260224_user_allowed_lines.sql`
5. `db/migrations/20260227_user_allowed_dashboards.sql`
6. `db/migrations/20260302_user_allowed_sedes.sql`
7. `db/migrations/20260303_ventas_x_item.sql`
8. `db/migrations/20260305_user_special_roles.sql`

Nota: `db/schema-auth.sql` no describe por si solo todas las columnas usadas hoy por la aplicacion.

### Scripts auxiliares

| Archivo | Uso |
| --- | --- |
| `scripts/create-admin.js` | crea o actualiza un admin usando `ADMIN_USERNAME`, `ADMIN_PASSWORD` y `DB_PASSWORD` del entorno o `.env.local` |
| `test-db.js` | prueba conexion, lista tablas y consulta `ventas_cajas` usando `DB_PASSWORD` del entorno o `.env.local` |
| `test-db-postgres.js` | valida conexion con PostgreSQL y verifica el usuario `produ` usando `DB_PASSWORD` del entorno o `.env.local` |
| `db/crear-usuario.sql` | crea el usuario PostgreSQL `produ` |
| `db/permisos-usuario.sql` | otorga permisos sobre `public` |
| `db/seed_sede_users.sql` | inserta usuarios base por sede |
| `db/establecer-password.sql` | apoyo operativo para gestion de password |

## 7. Riesgos abiertos y mantenimiento

### Vacios actuales

- No se encontro documentacion de despliegue.
- No se encontro documentacion de backup, restore ni observabilidad.
- No se encontro CI versionado ni checklist formal de release.
- La ausencia de `middleware.ts` obliga a repetir validaciones en cliente y API.
- Parte importante de la logica de negocio sigue concentrada en handlers grandes, especialmente `src/app/api/hourly-analysis/route.ts` y `src/app/api/productivity/route.ts`.

### Cuando actualizar este documento

Actualizar `README.md` si cambia cualquiera de estos puntos:

- se agrega o elimina una seccion o modulo (incluido `src/lib/portal-sections.ts` y hubs como `/venta`)
- cambia el modelo de permisos, sesiones o headers de seguridad
- cambian tablas, migraciones o variables de entorno
- se introduce una integracion externa
- cambia la estrategia de cache, exportacion o despliegue

Estado de referencia: documentacion consolidada contra el codigo versionado el **2026-04-21**.
