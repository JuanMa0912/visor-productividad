# Operacion local y base de datos

## Objetivo

Reunir la informacion minima para levantar el proyecto localmente, revisar configuracion de base de datos y ejecutar migraciones o scripts auxiliares.

## Requisitos conocidos

- Node.js compatible con Next.js 16
- dependencias instaladas con `npm install`
- acceso a PostgreSQL con las tablas y migraciones necesarias

## Comandos principales

```bash
npm install
npm run dev
npm run lint
npm run build
npm run start
```

## Variables de entorno detectadas

No existe `.env.example`. Estas son las variables observadas en codigo:

| Variable | Uso | Default observado |
| --- | --- | --- |
| `DB_HOST` | host PostgreSQL | `192.168.35.232` en app, `localhost` en `test-db.js` |
| `DB_PORT` | puerto PostgreSQL | `5432` |
| `DB_NAME` | nombre de la base | `produXdia` |
| `DB_USER` | usuario BD | `postgres` en app, `produ` en `test-db.js` |
| `DB_PASSWORD` | password BD | valor sensible hardcodeado en app, vacio en `create-admin.js`, `produ` en `test-db.js` |
| `DB_SCHEMA` | schema para `search_path` | `public` |
| `SESSION_COOKIE_SECURE` | fuerza cookie segura | sin default explicito |
| `PRODUCTIVITY_CACHE_PATH` | ruta del cache JSON | `data/productivity-cache.json` |
| `NEXT_ENABLE_REACT_COMPILER` | activa `reactCompiler` | `false` si no esta definido |
| `UPGRADE_INSECURE_REQUESTS` | agrega directiva CSP | `false` |
| `CSP_UNSAFE_EVAL` | habilita `unsafe-eval` en CSP | `false` salvo desarrollo |
| `NEXT_PUBLIC_VENTAS_X_ITEM_USE_V2` | seleccion de API v2 de ventas x item | `false` si no es `1` |
| `ADMIN_USERNAME` | usuario para `scripts/create-admin.js` | sin default |
| `ADMIN_PASSWORD` | password para `scripts/create-admin.js` | sin default |

## Advertencias operativas

- Hay defaults sensibles versionados en algunos archivos.
- No hay un archivo `.env.example` para distribuir configuracion segura.
- Conviene revisar y externalizar `DB_PASSWORD` antes de cualquier despliegue serio.

## Base de datos

### Esquema base de auth

Archivo:

- `db/schema-auth.sql`

Tablas creadas:

- `app_users`
- `app_user_sessions`
- `app_user_login_logs`

### Migraciones necesarias para el estado actual del codigo

Orden recomendado:

1. `db/schema-auth.sql`
2. `db/migrations/20260203_auth_username.sql`
3. `db/migrations/20260220_user_sede.sql`
4. `db/migrations/20260224_user_allowed_lines.sql`
5. `db/migrations/20260227_user_allowed_dashboards.sql`
6. `db/migrations/20260302_user_allowed_sedes.sql`
7. `db/migrations/20260305_user_special_roles.sql`
8. `db/migrations/20260303_ventas_x_item.sql`

Observacion:

- `db/schema-auth.sql` no documenta por si solo todas las columnas que usa hoy la aplicacion.

### Scripts SQL auxiliares

| Archivo | Uso observado |
| --- | --- |
| `db/crear-usuario.sql` | crear usuario PostgreSQL `produ` |
| `db/permisos-usuario.sql` | otorgar permisos sobre `public` |
| `db/seed_sede_users.sql` | insertar usuarios base por sede |
| `db/establecer-password.sql` | archivo presente, no revisado en detalle en esta pasada |

### Scripts Node auxiliares

| Archivo | Uso observado |
| --- | --- |
| `scripts/create-admin.js` | crear o actualizar admin usando `ADMIN_USERNAME` y `ADMIN_PASSWORD` |
| `test-db.js` | probar conexion, listar tablas y consultar `ventas_cajas` |
| `test-db-postgres.js` | probar conexion con usuario `postgres` y verificar usuario `produ` |

## Flujo local sugerido

1. Instalar dependencias con `npm install`.
2. Configurar variables de entorno de DB.
3. Crear o verificar el usuario PostgreSQL si aplica.
4. Aplicar esquema y migraciones.
5. Verificar conectividad con `node test-db.js`.
6. Crear admin con `node scripts/create-admin.js` si se necesita.
7. Levantar la app con `npm run dev`.

## Archivos de configuracion relevantes

| Archivo | Proposito |
| --- | --- |
| `package.json` | scripts y dependencias |
| `next.config.ts` | headers de seguridad y `reactCompiler` |
| `tsconfig.json` | configuracion TypeScript y alias `@/*` |
| `tailwind.config.ts` | tema y tokens visuales |

## Vacios operativos actuales

- No se encontro documentacion de despliegue.
- No se encontro documentacion de backup, restore u observabilidad.
- No se encontro CI ni checklist versionado de release.
- No se encontro proceso documentado para generar `PRODUCTIVITY_CACHE_PATH`.
