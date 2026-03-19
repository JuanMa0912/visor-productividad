# Visor de Productividad

Aplicacion web interna construida con Next.js para consultar productividad, margenes, horario operativo y ventas por item de Mercamio, Mercatodo y Merkmios. Este archivo concentra toda la documentacion funcional y tecnica del repositorio.

## Objetivo del proyecto

El sistema centraliza tableros operativos que consumen informacion desde PostgreSQL y la presentan en una interfaz web interna con exportaciones a formatos de oficina y reportes visuales.

## Modulos actuales

| Modulo | Rutas principales | Proposito |
| --- | --- | --- |
| Productividad | `/`, `/productividad`, `/productividad/cajas` | ventas, horas, comparativos y analisis por hora |
| Margenes | `/margenes` | rentabilidad por linea y sede |
| Horario | `/horario`, `/jornada-extendida`, `/ingresar-horarios` | consulta de horas, reporte Alex y apoyo operativo |
| Ventas x item | `/ventas-x-item` | analisis por item, empresa, centro de operacion y rango |
| Administracion | `/admin/usuarios`, `/cuenta/contrasena` | gestion de usuarios, permisos y contrasenas |

## Stack

| Capa | Implementacion actual |
| --- | --- |
| Framework | Next.js 16.1.2 con App Router |
| UI | React 19.2.3 |
| Lenguaje | TypeScript |
| Estilos | Tailwind CSS 4 |
| Componentes | Radix UI y componentes locales |
| Graficos | MUI X Charts |
| Exportacion | ExcelJS, jsPDF, jsPDF AutoTable, canvas |
| Animacion | Anime.js |
| Persistencia | PostgreSQL via `pg` |
| Autenticacion | sesiones propias en DB |

## Arquitectura

`visor-productividad` usa una arquitectura directa: las paginas cliente en `src/app` consumen endpoints internos en `src/app/api`, y cada `route.ts` consulta PostgreSQL sin ORM ni una capa intermedia de servicios o repositorios.

### Diagrama de alto nivel

```text
Usuario
  -> paginas cliente en src/app
    -> fetch a /api/*
      -> route handlers Next.js
        -> src/lib/auth.ts
        -> src/lib/db.ts
        -> PostgreSQL

Exportaciones
  -> se generan en cliente
    -> XLSX / CSV / PDF / PNG

Caches actuales
  -> archivo local para /api/productivity
  -> memoria del proceso para /api/hourly-analysis
```

### Patrones de implementacion observados

- Las paginas funcionales principales usan `"use client"`.
- La autenticacion se valida en cliente para UX y en API para control efectivo.
- No se encontro `middleware.ts`.
- Las consultas SQL y la transformacion de datos viven dentro de los route handlers.
- La aplicacion depende de normalizaciones manuales de sedes, lineas, empresas y nombres de columnas.

### Librerias y piezas compartidas

| Archivo o componente | Uso |
| --- | --- |
| `src/lib/auth.ts` | sesiones, cookies, hashing, permisos y auditoria de IP |
| `src/lib/db.ts` | inicializacion del pool de PostgreSQL |
| `src/lib/constants.ts` | sedes, lineas y agrupaciones visibles |
| `src/lib/calc.ts` | calculos de productividad y margen |
| `src/lib/ventas-x-item.ts` | normalizacion y pivoteo de ventas por item |
| `HourlyAnalysis` | analisis por hora compartido entre productividad, cajas y jornada extendida |
| `TopBar` | encabezado del modulo de productividad |
| `LineCard`, `LineComparisonTable`, `SelectionSummary` | componentes reutilizados del tablero principal |

### Endpoints del backend

Los endpoints viven en `src/app/api` y estan organizados por dominio:

- `auth/*`
- `admin/*`
- `productivity`
- `hourly-analysis`
- `margenes`
- `jornada-extendida/*`
- `ingresar-horarios/options`
- `ventas-x-item/*`

Cada endpoint resuelve validacion de sesion, SQL, transformacion de datos y respuesta JSON en el mismo handler. En varios casos tambien refresca la cookie de sesion.

### Decisiones y deuda tecnica visible

- PostgreSQL es la fuente principal de verdad.
- No se observaron integraciones HTTP externas de negocio.
- Las exportaciones se hacen en cliente para evitar jobs backend.
- Los caches actuales son locales al proceso o al filesystem; no son distribuidos.
- No hay separacion fuerte entre capa HTTP, dominio y acceso a datos.
- Parte de la UI y del analisis vive en archivos grandes, especialmente `src/app/page.tsx`.

## Seguridad y accesos

La aplicacion usa autenticacion propia. Los usuarios viven en PostgreSQL, las contrasenas se verifican con `bcryptjs` y las sesiones se almacenan en `app_user_sessions`.

### Flujo de autenticacion

1. El usuario entra por `/login`.
2. La UI llama `POST /api/auth/login`.
3. El backend busca el usuario en `app_users`.
4. Verifica existencia, estado activo y coincidencia del `password_hash`.
5. Si el login es valido:
   - crea una sesion en `app_user_sessions`
   - registra acceso en `app_user_login_logs`
   - actualiza `last_login_at` y `last_login_ip`
   - devuelve la cookie `vp_session`
6. La UI consulta `GET /api/auth/me` para conocer el usuario actual.
7. Los endpoints protegidos validan la sesion con `requireAuthSession` o `requireAdminSession`.

### Cookie de sesion

| Propiedad | Valor actual |
| --- | --- |
| Nombre | `vp_session` |
| Tipo | `httpOnly` |
| `sameSite` | `lax` |
| `secure` | depende de `SESSION_COOKIE_SECURE` o `NODE_ENV=production` |
| Expiracion | deslizante, 60 minutos de inactividad |
| Revocacion | `logout` marca la sesion como revocada y expira la cookie |

### Modelo de permisos

| Campo | Uso |
| --- | --- |
| `username` | identificador de login |
| `role` | `admin` o `user` |
| `sede` | sede legacy o fallback por usuario |
| `allowed_sedes` | sedes permitidas |
| `allowed_lines` | lineas permitidas |
| `allowed_dashboards` | tableros permitidos |
| `special_roles` | roles especiales adicionales |
| `is_active` | habilita o bloquea acceso |
| `last_login_at` | ultima fecha de acceso |
| `last_login_ip` | ultima IP conocida |

Reglas observadas:

- `admin` tiene acceso total.
- `user` debe tener al menos una sede valida.
- `allowed_dashboards = NULL` equivale a todos los tableros.
- `allowed_lines = NULL` equivale a todas las lineas.
- `allowed_sedes = NULL` o incluir `Todas` equivale a acceso amplio de sedes.
- `special_roles` hoy incluye el permiso `alex`.

### Dashboards y permisos

| Id de permiso | Rutas relacionadas | Notas |
| --- | --- | --- |
| `productividad` | `/productividad`, `/`, `/productividad/cajas` | el analisis horario tambien lo usa |
| `margenes` | `/margenes` | se combina con restricciones por linea |
| `jornada-extendida` | `/horario`, `/jornada-extendida`, `/ingresar-horarios` | el acceso visible entra por el hub `/horario` |
| `ventas-x-item` | `/ventas-x-item` | aplica a v1 y v2 |

### Endpoints de auth y administracion

| Endpoint | Metodo | Acceso requerido | Proposito |
| --- | --- | --- | --- |
| `/api/auth/login` | `POST` | publico | login |
| `/api/auth/me` | `GET` | sesion valida | usuario actual |
| `/api/auth/logout` | `POST` | sesion opcional | cierre de sesion |
| `/api/auth/change-password` | `POST` | sesion valida | cambio de contrasena |
| `/api/admin/users` | `GET`, `POST` | admin | listar y crear usuarios |
| `/api/admin/users/[id]` | `PATCH`, `DELETE` | admin | editar o eliminar usuarios |
| `/api/admin/login-logs` | `GET`, `DELETE` | admin | consultar o limpiar bitacora de accesos |

### Endpoints protegidos del negocio

| Endpoint | Metodo | Control principal |
| --- | --- | --- |
| `/api/productivity` | `GET` | sesion, dashboard, lineas y sedes |
| `/api/hourly-analysis` | `GET` | sesion, dashboard, lineas y sedes |
| `/api/margenes` | `GET` | sesion, dashboard y lineas |
| `/api/ingresar-horarios/options` | `GET` | sesion, dashboard y sedes |
| `/api/jornada-extendida/meta` | `GET` | sesion, dashboard y sedes |
| `/api/jornada-extendida/alex-report` | `GET` | sesion, dashboard y rol `alex` o admin |
| `/api/ventas-x-item` | `GET` | sesion y dashboard |
| `/api/ventas-x-item/v2` | `GET` | sesion y dashboard |

### Headers de seguridad y limitaciones

`next.config.ts` aplica estos headers a todas las rutas:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Resource-Policy`
- `Referrer-Policy`
- `Permissions-Policy`

Rate limits observados:

| Endpoint | Limite |
| --- | --- |
| `/api/productivity` | 120 req/min/IP |
| `/api/margenes` | 120 req/min/IP |
| `/api/hourly-analysis` | 120 req/min/IP |
| `/api/ventas-x-item` | 90 req/min/IP |
| `/api/ventas-x-item/v2` | 120 req/min/IP |

Limitaciones actuales:

- La aplicacion no usa `middleware.ts` para centralizar auth.
- El rate limit es en memoria del proceso y no se comparte entre replicas.
- No se observo rate limit explicito sobre login.
- No se encontro un proceso documentado de limpieza de sesiones expiradas.

## Integraciones y datos

La integracion principal del proyecto es PostgreSQL. No se observaron APIs HTTP externas de negocio, colas, brokers, object storage ni servicios de autenticacion externos dentro del codigo versionado.

### Panorama general

| Tipo | Integracion | Uso |
| --- | --- | --- |
| Base de datos | PostgreSQL via `pg` | auth, productividad, margenes, horario y ventas x item |
| Archivo local | cache JSON de productividad | fallback o lectura rapida para `/api/productivity` |
| Memoria del proceso | cache del analisis horario | respuestas y columnas de `/api/hourly-analysis` |
| Librerias cliente | ExcelJS, jsPDF, canvas | exportaciones |
| UI charts | MUI X Charts | visualizacion |

### Tablas principales por dominio

| Dominio | Tablas |
| --- | --- |
| Auth y administracion | `app_users`, `app_user_sessions`, `app_user_login_logs` |
| Productividad | `ventas_cajas`, `ventas_fruver`, `ventas_industria`, `ventas_carnes`, `ventas_pollo_pesc`, `ventas_asadero`, `asistencia_horas` |
| Margenes | `margenes_linea_co_dia` |
| Ventas x item | `ventas_item_diario`, `ventas_item_cargas`, `ventas_item_sede_map` |

### Modulo por modulo

#### Productividad

- Endpoint principal: `GET /api/productivity`
- Fuentes: tablas `ventas_*` y `asistencia_horas`
- Comportamiento: rate limit por IP, cache local, fallback vacio cuando falla DB sin cache, filtrado por lineas y sedes permitidas
- Transformaciones: mapeo manual de `centro_operacion + empresa_bd -> sede`, normalizacion de sedes de asistencia y mapeo de departamento -> linea

#### Analisis por hora

- Endpoint: `GET /api/hourly-analysis`
- Fuentes: tablas `ventas_*` y `asistencia_horas`
- Parametros principales: `date`, `sede`, `line`, `bucketMinutes`, `includePeople`, `overtimeDateStart`, `overtimeDateEnd`
- Comportamiento: cache en memoria por combinacion de parametros, cache de columnas de `asistencia_horas`, filtrado por sedes y lineas segun permisos

#### Margenes

- Endpoint: `GET /api/margenes`
- Fuente: `margenes_linea_co_dia`
- Comportamiento: agregacion SQL directa, rate limit por IP, filtrado por lineas permitidas y mapeo manual de empresa + centro -> sede

#### Jornada extendida

- Endpoints: `GET /api/jornada-extendida/meta`, `GET /api/jornada-extendida/alex-report`, `GET /api/hourly-analysis`, `GET /api/ingresar-horarios/options`
- Fuente principal: `asistencia_horas`
- Uso: fechas disponibles, sedes visibles, empleados de cajas, reporte Alex por rango y analisis horario reutilizado

#### Ventas x item

- Endpoints: `GET /api/ventas-x-item` y `GET /api/ventas-x-item/v2`
- Fuente principal: `ventas_item_diario`
- Apoyo: `ventas_item_sede_map` y `ventas_item_cargas`
- La UI elige v1 o v2 con `NEXT_PUBLIC_VENTAS_X_ITEM_USE_V2`
- Existen chequeos de paridad entre ambas versiones

Parametros relevantes de v1/v2:

| Parametro | v1 | v2 | Uso |
| --- | --- | --- | --- |
| `start` | si | si | inicio de rango |
| `end` | si | si | fin de rango |
| `mode` | si | si | `meta`, `summary` y `options` en v2 |
| `empresa` | si | si | filtro por empresa |
| `itemIds` | si | si | filtro por items |
| `itemQuery` | no | si | busqueda libre |
| `idCo` | no | si | filtro por centro de operacion |
| `maxRows` | si | si | limite de filas |
| `offset` | si | si | paginacion |
| `optionLimit` | no | si | limite para `options` |

### Exportaciones

| Modulo | Exportaciones observadas | Tecnologia |
| --- | --- | --- |
| Productividad | PDF, CSV, XLSX | jsPDF, ExcelJS |
| Analisis horario | XLSX | ExcelJS |
| Jornada extendida | PNG para tabla Alex | canvas |
| Ventas x item | XLSX | ExcelJS |

### Riesgos de integracion

- El sistema depende de varias normalizaciones manuales de sedes, empresas y departamentos.
- Cambios en nombres de columnas dentro de `asistencia_horas` pueden romper funciones que detectan columnas dinamicamente.
- No se encontro documentacion del proceso que carga `ventas_item_diario`.
- El ciclo de vida del cache `PRODUCTIVITY_CACHE_PATH` no esta documentado fuera del codigo.

## Operacion local

### Requisitos

- Node.js compatible con Next.js 16
- dependencias instaladas con `npm install`
- acceso a PostgreSQL con tablas y migraciones aplicadas

### Comandos principales

```bash
npm install
npm run dev
npm run lint
npm run build
npm run start
```

### Flujo local sugerido

1. Instalar dependencias con `npm install`.
2. Configurar variables de entorno de base de datos y seguridad.
3. Crear o verificar el usuario PostgreSQL si aplica.
4. Aplicar esquema y migraciones.
5. Verificar conectividad con `node test-db.js`.
6. Crear un admin con `node scripts/create-admin.js` si hace falta.
7. Levantar la app con `npm run dev`.

## Base de datos y entorno

### Variables de entorno detectadas

No existe `.env.example`. Estas son las variables observadas en el codigo:

| Variable | Uso | Default observado |
| --- | --- | --- |
| `DB_HOST` | host PostgreSQL | `192.168.35.232` en app y `create-admin.js`; `localhost` en `test-db.js` |
| `DB_PORT` | puerto PostgreSQL | `5432` |
| `DB_NAME` | nombre de la base | `produXdia` |
| `DB_USER` | usuario DB | `postgres` en app y `create-admin.js`; `produ` en `test-db.js` |
| `DB_PASSWORD` | password DB | valor sensible hardcodeado en app, vacio en `create-admin.js`, `produ` en `test-db.js` |
| `DB_SCHEMA` | schema para `search_path` | `public` |
| `SESSION_COOKIE_SECURE` | fuerza cookie segura | sin default explicito |
| `AUDIT_IP_HMAC_SECRET` | anonimiza IP auditada mediante HMAC | sin default explicito |
| `PRODUCTIVITY_CACHE_PATH` | ruta del cache JSON | `data/productivity-cache.json` |
| `NEXT_ENABLE_REACT_COMPILER` | activa `reactCompiler` | `false` si no esta definido |
| `UPGRADE_INSECURE_REQUESTS` | agrega directiva CSP | `false` |
| `CSP_UNSAFE_EVAL` | habilita `unsafe-eval` en CSP | `false`, salvo si se habilita o se esta en desarrollo |
| `NEXT_PUBLIC_VENTAS_X_ITEM_USE_V2` | usa API v2 de ventas x item | `false` salvo valor `1` |
| `ADMIN_USERNAME` | usuario para `scripts/create-admin.js` | sin default |
| `ADMIN_PASSWORD` | password para `scripts/create-admin.js` | sin default |

### Advertencias operativas

- Hay defaults sensibles versionados en el codigo.
- No existe un `.env.example` para distribuir configuracion segura.
- Conviene externalizar `DB_PASSWORD` antes de cualquier despliegue serio.

### Esquema y migraciones

Archivo base de auth:

- `db/schema-auth.sql`

Tablas creadas por el esquema base:

- `app_users`
- `app_user_sessions`
- `app_user_login_logs`

Orden recomendado de migraciones para reflejar el estado actual del codigo:

1. `db/schema-auth.sql`
2. `db/migrations/20260203_auth_username.sql`
3. `db/migrations/20260220_user_sede.sql`
4. `db/migrations/20260224_user_allowed_lines.sql`
5. `db/migrations/20260227_user_allowed_dashboards.sql`
6. `db/migrations/20260302_user_allowed_sedes.sql`
7. `db/migrations/20260303_ventas_x_item.sql`
8. `db/migrations/20260305_user_special_roles.sql`

Observacion: `db/schema-auth.sql` no documenta por si solo todas las columnas usadas hoy por la aplicacion.

### Scripts auxiliares

SQL:

| Archivo | Uso observado |
| --- | --- |
| `db/crear-usuario.sql` | crea el usuario PostgreSQL `produ` |
| `db/permisos-usuario.sql` | otorga permisos sobre `public` |
| `db/seed_sede_users.sql` | inserta usuarios base por sede |
| `db/establecer-password.sql` | archivo presente para gestion de password |

Node:

| Archivo | Uso observado |
| --- | --- |
| `scripts/create-admin.js` | crea o actualiza un admin usando `ADMIN_USERNAME` y `ADMIN_PASSWORD` |
| `test-db.js` | prueba conexion, lista tablas y consulta `ventas_cajas` |
| `test-db-postgres.js` | prueba conexion con usuario `postgres` y verifica el usuario `produ` |

### Archivos de configuracion relevantes

| Archivo | Proposito |
| --- | --- |
| `package.json` | scripts y dependencias |
| `next.config.ts` | headers de seguridad y `reactCompiler` |
| `tsconfig.json` | configuracion TypeScript y alias `@/*` |
| `tailwind.config.ts` | tema y tokens visuales |

## Riesgos y vacios actuales

- No se encontro documentacion de despliegue.
- No se encontro documentacion de backup, restore u observabilidad.
- No se encontro CI ni checklist versionado de release.
- La ausencia de `middleware.ts` obliga a repetir validaciones entre cliente y API.
- El modelo de permisos depende de que los datos de `app_users` esten migrados correctamente.

## Mantenimiento de esta documentacion

Actualizar este archivo cuando ocurra alguno de estos cambios:

- se agregue o elimine un tablero
- cambie el modelo de permisos o sesiones
- cambien tablas, migraciones o variables de entorno
- se agregue una integracion externa
- cambie la estrategia de cache, exportacion o despliegue

Estado de referencia: documentacion consolidada a partir del codigo versionado el 2026-03-18.
