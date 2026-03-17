# Documentacion tecnica preliminar

## 1. Estado del documento

- Tipo: borrador brownfield para levantamiento
- Objetivo: dejar una foto tecnica inicial del proyecto para entrevistas, validacion funcional y cierre de vacios
- Alcance de esta version: integraciones, accesos, arquitectura y operacion local
- Fuente de verdad usada para este borrador: codigo y scripts actualmente versionados en este repositorio
- Fecha del levantamiento: 2026-03-17

## 2. Resumen ejecutivo

`visor-productividad` es una aplicacion interna construida sobre Next.js App Router. El frontend esta implementado principalmente como paginas cliente (`"use client"`) que consumen endpoints internos en `src/app/api`. El backend expone route handlers que ejecutan SQL directo contra PostgreSQL mediante `pg`, sin una capa separada de servicios o repositorios.

La autenticacion es propia, basada en usuarios almacenados en PostgreSQL, contrasenas con `bcryptjs` y sesiones persistidas en la tabla `app_user_sessions`. El control de acceso combina:

- rol (`admin` o `user`)
- sedes permitidas
- lineas permitidas
- tableros permitidos
- roles especiales (`alex`)

No se encontraron integraciones HTTP externas ni SDKs de terceros para negocio. Las integraciones observadas son principalmente:

- PostgreSQL como origen transaccional y analitico
- cache local por archivo para productividad
- cache en memoria para analisis por hora
- exportacion cliente a XLSX, CSV, PDF y PNG

## 3. Cobertura revisada

### 3.1 Superficie documental existente

- `README.md` existia pero era el archivo por defecto de Next.js
- No existia carpeta `docs/`
- No se encontro `.env.example`
- No se encontro documentacion de despliegue, CI/CD, backup o soporte operativo

### 3.2 Superficie tecnica revisada

- `package.json`
- `next.config.ts`
- `src/lib/*.ts`
- `src/app/**/*.tsx`
- `src/app/api/**/route.ts`
- `db/*.sql`
- `db/migrations/*.sql`
- `scripts/*.js`

### 3.3 Hallazgos de estructura

- No se encontro `middleware.ts`
- La validacion de acceso ocurre en dos capas:
  - redireccion en paginas cliente via `/api/auth/me`
  - validacion efectiva en route handlers del API

## 4. Stack actual

| Capa | Implementacion actual | Evidencia principal |
| --- | --- | --- |
| Framework web | Next.js 16.1.2 | `package.json` |
| UI | React 19.2.3 | `package.json` |
| Lenguaje | TypeScript estricto | `tsconfig.json` |
| Estilos | Tailwind CSS 4 | `tailwind.config.ts` |
| Componentes UI | Radix UI + utilidades locales | `src/components/ui/*` |
| Graficos | `@mui/x-charts` | `src/app/page.tsx`, `src/app/ventas-x-item/page.tsx` |
| Animacion | `animejs` | `src/app/page.tsx` |
| Exportacion | `exceljs`, `jspdf`, `jspdf-autotable` | `src/app/page.tsx`, `src/components/HourlyAnalysis.tsx`, `src/app/ventas-x-item/page.tsx` |
| Autenticacion | propia con sesiones en DB | `src/lib/auth.ts` |
| Base de datos | PostgreSQL via `pg` | `src/lib/db.ts` |

## 5. Arquitectura actual

### 5.1 Vista general

```text
Navegador
  -> paginas App Router (cliente)
    -> fetch a /api/*
      -> route handlers Next.js
        -> src/lib/auth.ts
        -> src/lib/db.ts
        -> PostgreSQL

Navegador
  -> exportaciones locales
    -> ExcelJS / jsPDF / canvas PNG

/api/productivity
  -> cache local opcional por archivo JSON

/api/hourly-analysis
  -> cache temporal en memoria del proceso
```

### 5.2 Patron de implementacion

- La mayor parte de la UI corre como componente cliente.
- La capa API usa SQL embebido directamente en cada `route.ts`.
- No se identifico una capa comun de repositorio, ORM o query builder.
- `src/lib/auth.ts` y `src/lib/db.ts` son las piezas compartidas mas relevantes.
- La pagina principal de productividad esta concentrada en un solo archivo grande: `src/app/page.tsx`.

### 5.3 Rutas funcionales visibles

| Ruta | Funcion |
| --- | --- |
| `/login` | inicio de sesion |
| `/tableros` | selector de tableros segun permisos |
| `/productividad` | hub de productividad |
| `/` | tablero principal de productividad por linea |
| `/productividad/cajas` | vista enfocada en cajas y analisis por hora |
| `/margenes` | tablero de margenes |
| `/horario` | hub de horario |
| `/jornada-extendida` | consulta de horas trabajadas y reporte Alex |
| `/ingresar-horarios` | plantilla/formato operativo para horarios |
| `/ventas-x-item` | tablero de ventas por item |
| `/admin/usuarios` | administracion de usuarios y bitacora de accesos |
| `/cuenta/contrasena` | cambio de contrasena del usuario autenticado |

### 5.4 Reuso de componentes

- `HourlyAnalysis` es un componente reutilizado desde:
  - `src/app/page.tsx`
  - `src/app/productividad/cajas/page.tsx`
  - `src/app/jornada-extendida/page.tsx`
- `TopBar`, `LineCard`, `LineComparisonTable`, `SelectionSummary` y otros componentes apoyan el tablero principal.

## 6. Integraciones y fuentes de datos

### 6.1 Integracion principal: PostgreSQL

La app se conecta a una base PostgreSQL configurada desde `src/lib/db.ts`. Se usa un `Pool` global de `pg` y el `search_path` se controla con `DB_SCHEMA`.

### Tablas de autenticacion y administracion

- `app_users`
- `app_user_sessions`
- `app_user_login_logs`

### Tablas de productividad

- `ventas_cajas`
- `ventas_fruver`
- `ventas_industria`
- `ventas_carnes`
- `ventas_pollo_pesc`
- `ventas_asadero`
- `asistencia_horas`

### Tablas de margenes

- `margenes_linea_co_dia`

### Tablas de ventas por item

- `ventas_item_diario`
- `ventas_item_cargas`
- `ventas_item_sede_map`

### 6.2 Integracion por modulo

### Productividad

Origenes usados:

- ventas por linea desde tablas `ventas_*`
- horas trabajadas desde `asistencia_horas`

Caracteristicas tecnicas:

- rate limit en memoria por IP
- puede responder desde archivo cache local `data/productivity-cache.json`
- si no existe cache, intenta leer directo desde DB
- si falla la DB y no hay cache, devuelve fallback vacio con mensaje de error

Notas:

- El endpoint mezcla ventas y horas por `fecha + sede`
- Existe normalizacion manual de sedes y departamentos
- El dashboard permite exportacion cliente a PDF, CSV y XLSX

### Analisis por hora

Origenes usados:

- ventas horarias desde las tablas `ventas_*`
- asistencia y presencia desde `asistencia_horas`

Caracteristicas tecnicas:

- endpoint compartido: `/api/hourly-analysis`
- rate limit en memoria
- cache de respuestas en memoria por combinacion de parametros
- cache de columnas de `asistencia_horas` en memoria
- soporta `bucketMinutes` de `60, 30, 20, 15, 10`
- soporta desglose opcional por persona

### Margenes

Origen:

- `margenes_linea_co_dia`

Caracteristicas:

- agregacion directa en SQL
- rate limit en memoria
- filtrado por lineas permitido para usuarios no admin

### Jornada extendida / horario

Origen:

- `asistencia_horas`

Uso funcional:

- obtener fechas disponibles
- limitar sedes visibles segun permisos
- construir analisis horario
- construir reporte Alex
- listar empleados de cajas para el modulo `ingresar-horarios`

### Ventas x item

Origen:

- `ventas_item_diario`
- `ventas_item_sede_map`
- `ventas_item_cargas`

Caracteristicas:

- dos versiones de API: `/api/ventas-x-item` y `/api/ventas-x-item/v2`
- la UI decide la version con `NEXT_PUBLIC_VENTAS_X_ITEM_USE_V2`
- la pagina tiene logica de preparacion, pivoteo y comparacion adicional en cliente
- la UI incluye verificacion de paridad entre v1 y v2
- exportacion cliente a XLSX

### Librerias cliente

No son integraciones de negocio, pero si componentes tecnicos relevantes:

- `@mui/x-charts` para graficos
- `exceljs` para exportar hojas de calculo
- `jspdf` y `jspdf-autotable` para PDF
- `animejs` para animaciones del tablero principal

### Integraciones externas no encontradas

En el codigo revisado no se observaron:

- APIs HTTP externas
- servicios SaaS de autenticacion
- colas
- almacenamiento object storage
- telemetria o monitoreo externos

Esto es una observacion del repositorio actual, no una afirmacion sobre la infraestructura completa fuera del codigo.

## 7. Accesos, autenticacion y seguridad

### 7.1 Flujo de autenticacion

1. El usuario inicia sesion en `/login`.
2. La UI llama `POST /api/auth/login`.
3. El backend valida `username` y `password_hash` contra `app_users`.
4. Si el usuario esta activo y la contrasena es valida:
   - crea sesion en `app_user_sessions`
   - registra acceso en `app_user_login_logs`
   - actualiza `last_login_at` y `last_login_ip`
   - devuelve cookie `vp_session`
5. Las paginas consultan `/api/auth/me` para cargar contexto y redireccionar.
6. Cada endpoint protegido vuelve a validar la sesion con `requireAuthSession` o `requireAdminSession`.

### 7.2 Modelo de acceso

| Campo | Uso actual |
| --- | --- |
| `role` | `admin` o `user` |
| `sede` | sede legacy / default del usuario |
| `allowed_sedes` | sedes visibles para usuarios no admin |
| `allowed_lines` | lineas visibles/consultables |
| `allowed_dashboards` | tableros habilitados |
| `special_roles` | roles extra; hoy se usa `alex` |
| `is_active` | activa o bloquea ingreso |

### 7.3 Reglas observadas

- `admin` tiene acceso total y normalmente no mantiene restricciones por sede, lineas o tableros.
- `user` debe tener al menos una sede valida.
- `allowed_dashboards = NULL` significa "todos".
- `allowed_lines = NULL` significa "todas".
- `allowed_sedes = NULL` o incluir `Todas` implica acceso amplio a sedes.
- El rol especial `alex` habilita el reporte Alex dentro de jornada extendida.

### 7.4 Relacion entre dashboards y permisos

| Id de dashboard | Ruta visible principal | Notas |
| --- | --- | --- |
| `productividad` | `/productividad` y `/` | tambien habilita piezas de analisis por hora |
| `margenes` | `/margenes` | usa control de lineas |
| `jornada-extendida` | `/horario`, `/jornada-extendida`, `/ingresar-horarios` | el card lleva al hub `/horario` |
| `ventas-x-item` | `/ventas-x-item` | v1/v2 comparten el mismo permiso |

### 7.5 Endpoints de acceso

| Endpoint | Metodo | Control | Uso |
| --- | --- | --- | --- |
| `/api/auth/login` | `POST` | publico | login |
| `/api/auth/me` | `GET` | sesion valida | obtener usuario autenticado |
| `/api/auth/logout` | `POST` | sesion opcional | cerrar sesion |
| `/api/auth/change-password` | `POST` | sesion valida | cambiar contrasena |
| `/api/admin/users` | `GET`, `POST` | admin | listar y crear usuarios |
| `/api/admin/users/[id]` | `PATCH`, `DELETE` | admin | editar o eliminar usuario |
| `/api/admin/login-logs` | `GET`, `DELETE` | admin | consultar o limpiar bitacora |

### 7.6 Endpoints funcionales

| Endpoint | Metodo | Requiere sesion | Restricciones relevantes |
| --- | --- | --- | --- |
| `/api/productivity` | `GET` | si | dashboard `productividad` o `jornada-extendida`, lineas, sedes |
| `/api/hourly-analysis` | `GET` | si | dashboard `productividad` o `jornada-extendida`, lineas, sedes |
| `/api/margenes` | `GET` | si | dashboard `margenes`, lineas |
| `/api/ingresar-horarios/options` | `GET` | si | dashboard `jornada-extendida`, sedes |
| `/api/jornada-extendida/meta` | `GET` | si | dashboard `jornada-extendida`, sedes, `specialRoles` para Alex |
| `/api/jornada-extendida/alex-report` | `GET` | si | dashboard `jornada-extendida` y rol especial `alex` o admin |
| `/api/ventas-x-item` | `GET` | si | dashboard `ventas-x-item` |
| `/api/ventas-x-item/v2` | `GET` | si | dashboard `ventas-x-item` |

### 7.7 Cookie y headers

Cookie de sesion:

- nombre: `vp_session`
- tipo: `httpOnly`
- `sameSite`: `lax`
- `secure`: depende de `SESSION_COOKIE_SECURE` o de `NODE_ENV=production`
- expiracion deslizante: 60 minutos de inactividad

Headers de seguridad definidos globalmente en `next.config.ts`:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Resource-Policy`
- `Referrer-Policy`
- `Permissions-Policy`

### 7.8 Rate limit y cache

| Endpoint | Rate limit observado | Cache observado |
| --- | --- | --- |
| `/api/productivity` | 120 req / min / IP | archivo JSON local |
| `/api/margenes` | 120 req / min / IP | no |
| `/api/hourly-analysis` | 120 req / min / IP | memoria del proceso |
| `/api/ventas-x-item` | 90 req / min / IP | no |
| `/api/ventas-x-item/v2` | 120 req / min / IP | no |

Observacion importante:

- tanto el rate limit como la cache en memoria son locales al proceso Node actual; no se comparten entre replicas

## 8. Base de datos y migraciones

### 8.1 Esquema de autenticacion

Archivo base:

- `db/schema-auth.sql`

Tablas creadas ahi:

- `app_users`
- `app_user_sessions`
- `app_user_login_logs`

### 8.2 Migraciones requeridas por el codigo actual

El codigo usa columnas que no quedan reflejadas completamente en `db/schema-auth.sql`. Para que la administracion y los permisos funcionen, tambien se requieren estas migraciones:

1. `20260203_auth_username.sql`
2. `20260220_user_sede.sql`
3. `20260224_user_allowed_lines.sql`
4. `20260227_user_allowed_dashboards.sql`
5. `20260302_user_allowed_sedes.sql`
6. `20260305_user_special_roles.sql`

Para el tablero de ventas por item tambien se requiere:

7. `20260303_ventas_x_item.sql`

### 8.3 Scripts auxiliares de base de datos

| Archivo | Uso observado |
| --- | --- |
| `db/crear-usuario.sql` | crear usuario PostgreSQL `produ` |
| `db/permisos-usuario.sql` | otorgar permisos sobre `public` |
| `db/seed_sede_users.sql` | sembrar usuarios de sede |
| `scripts/create-admin.js` | crear o actualizar admin desde variables de entorno |
| `test-db.js` | probar conexion y tablas usando `.env.local` si existe |
| `test-db-postgres.js` | probar conexion con usuario `postgres` |

## 9. Variables de entorno y configuracion

No existe `.env.example`. Las variables detectadas en codigo son:

| Variable | Uso | Default observado |
| --- | --- | --- |
| `DB_HOST` | host PostgreSQL | `192.168.35.232` en app, `localhost` en `test-db.js` |
| `DB_PORT` | puerto PostgreSQL | `5432` |
| `DB_NAME` | nombre BD | `produXdia` |
| `DB_USER` | usuario BD | `postgres` en app, `produ` en `test-db.js` |
| `DB_PASSWORD` | clave BD | valor sensible hardcodeado en app, vacio en `create-admin.js`, `produ` en `test-db.js` |
| `DB_SCHEMA` | `search_path` | `public` |
| `SESSION_COOKIE_SECURE` | fuerza cookie segura | sin default explicito |
| `PRODUCTIVITY_CACHE_PATH` | archivo cache de productividad | `data/productivity-cache.json` |
| `NEXT_ENABLE_REACT_COMPILER` | activa `reactCompiler` | `false` si no esta definido |
| `UPGRADE_INSECURE_REQUESTS` | agrega directiva CSP | `false` |
| `CSP_UNSAFE_EVAL` | habilita `unsafe-eval` en CSP | `false` salvo desarrollo |
| `NEXT_PUBLIC_VENTAS_X_ITEM_USE_V2` | la UI usa API v2 | `false` si no es `1` |
| `ADMIN_USERNAME` | insumo para `scripts/create-admin.js` | sin default |
| `ADMIN_PASSWORD` | insumo para `scripts/create-admin.js` | sin default |

## 10. Operacion local conocida

Scripts declarados en `package.json`:

```bash
npm run dev
npm run build
npm run start
npm run lint
```

Utilidades sueltas:

```bash
node scripts/create-admin.js
node test-db.js
node test-db-postgres.js
```

## 11. Riesgos y gaps detectados

### 11.1 Hallazgos tecnicos

- Hay credenciales y valores sensibles por defecto en codigo (`src/lib/db.ts`, `test-db-postgres.js`).
- No existe `.env.example`.
- No se encontro middleware central de autenticacion; el control se reparte entre UI cliente y API.
- El rate limit y la cache en memoria no son distribuidos.
- `schema-auth.sql` no refleja por si solo todas las columnas usadas hoy por la app.
- No se encontraron pruebas automatizadas ni pipeline CI en el repositorio revisado.
- No se encontro documentacion de despliegue, observabilidad, backup o recuperacion.
- `src/app/page.tsx` concentra mucha logica de presentacion y exportacion en un solo archivo.

### 11.2 Hallazgos funcionales a confirmar

- `ingresar-horarios` carga sedes y empleados, pero no se encontro un endpoint de guardado de horarios; hoy parece una vista/formato operativo cliente.
- `productivity` puede responder desde un archivo cache local, pero en el repo no hay proceso documentado para generarlo o refrescarlo.
- `ventas-x-item` depende de que la tabla `ventas_item_diario` ya este poblada; no se encontro el proceso ETL/carga dentro de este repositorio.

## 12. Preguntas abiertas para el siguiente levantamiento

1. Cual es el entorno de despliegue real (servidor, contenedor, servicio administrado, proxy, SSL)?
2. Quien es responsable del proceso de carga de datos hacia `ventas_*`, `asistencia_horas`, `margenes_linea_co_dia` y `ventas_item_diario`?
3. Con que frecuencia se actualiza cada tabla y cual es la latencia esperada de negocio?
4. Existe un proceso programado para limpiar sesiones expiradas en `app_user_sessions`?
5. El archivo cache de productividad se genera manualmente o por un job externo?
6. `ingresar-horarios` debe persistir informacion o solo imprimir/exportar formatos?
7. El rol especial `alex` es el unico rol especial esperado o habra mas?
8. Existe un modelo formal de auditoria, backup y retencion de `app_user_login_logs`?
9. Cual es el comportamiento esperado ante multiples instancias de la app en produccion?
10. Se necesita documentar tambien infraestructura, monitoreo y soporte operativo en una segunda fase?

## 13. Recomendacion para la siguiente iteracion documental

Orden sugerido:

1. Confirmar variables de entorno y entorno de despliegue.
2. Documentar el proceso real de carga/refresco de datos.
3. Separar una referencia de endpoints y otra de modelo de permisos.
4. Crear un runbook operativo minimo para admin, migraciones y recuperacion.
