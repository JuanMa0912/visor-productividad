# Accesos y seguridad

## Objetivo

Documentar como autentica la aplicacion, como se autorizan usuarios y que controles tecnicos existen hoy.

## Resumen

La aplicacion usa autenticacion propia. Los usuarios viven en PostgreSQL, las contrasenas se verifican con `bcryptjs` y las sesiones se almacenan en `app_user_sessions`. El modelo de acceso combina rol, sedes, lineas, tableros y roles especiales.

## Flujo de autenticacion

1. El usuario entra por `/login`.
2. La UI llama `POST /api/auth/login`.
3. El backend busca al usuario en `app_users`.
4. Verifica:
   - que exista
   - que `is_active = true`
   - que la contrasena coincida con `password_hash`
5. Si el login es valido:
   - crea registro en `app_user_sessions`
   - registra acceso en `app_user_login_logs`
   - actualiza `last_login_at` y `last_login_ip`
   - devuelve cookie `vp_session`
6. La UI consulta `/api/auth/me` para obtener el usuario actual.
7. Los endpoints protegidos validan la sesion con `requireAuthSession` o `requireAdminSession`.

## Cookie de sesion

| Propiedad | Valor actual |
| --- | --- |
| Nombre | `vp_session` |
| Tipo | `httpOnly` |
| `sameSite` | `lax` |
| `secure` | depende de `SESSION_COOKIE_SECURE` o `NODE_ENV=production` |
| Expiracion | deslizante, 60 minutos de inactividad |
| Revocacion | `logout` marca la sesion como revocada y expira la cookie |

## Modelo de usuario

Campos usados por la app:

| Campo | Uso |
| --- | --- |
| `username` | identificador de login |
| `role` | `admin` o `user` |
| `sede` | sede legacy / fallback por usuario |
| `allowed_sedes` | sedes permitidas |
| `allowed_lines` | lineas permitidas |
| `allowed_dashboards` | tableros permitidos |
| `special_roles` | roles especiales adicionales |
| `is_active` | habilita o bloquea el acceso |
| `last_login_at` | ultima fecha de acceso |
| `last_login_ip` | ultima IP conocida |

## Reglas de autorizacion observadas

- `admin` tiene acceso total.
- `user` debe tener al menos una sede valida.
- `allowed_dashboards = NULL` equivale a todos los tableros.
- `allowed_lines = NULL` equivale a todas las lineas.
- `allowed_sedes = NULL` o incluir `Todas` equivale a acceso amplio de sedes.
- `special_roles` hoy se usa para el permiso `alex`.

## Dashboards y permisos

| Id de permiso | Rutas relacionadas | Notas |
| --- | --- | --- |
| `productividad` | `/productividad`, `/`, `/productividad/cajas` | algunas piezas de analisis por hora tambien lo aceptan |
| `margenes` | `/margenes` | se combina con restricciones por linea |
| `jornada-extendida` | `/horario`, `/jornada-extendida`, `/ingresar-horarios` | el acceso visible entra por el hub `/horario` |
| `ventas-x-item` | `/ventas-x-item` | aplica a v1 y v2 del API |

## Rol especial

| Rol | Uso actual |
| --- | --- |
| `alex` | habilita el reporte Alex dentro de jornada extendida |

## Endpoints de autenticacion y administracion

| Endpoint | Metodo | Acceso requerido | Proposito |
| --- | --- | --- | --- |
| `/api/auth/login` | `POST` | publico | login |
| `/api/auth/me` | `GET` | sesion valida | usuario actual |
| `/api/auth/logout` | `POST` | sesion opcional | cierre de sesion |
| `/api/auth/change-password` | `POST` | sesion valida | cambiar contrasena |
| `/api/admin/users` | `GET`, `POST` | admin | listar y crear usuarios |
| `/api/admin/users/[id]` | `PATCH`, `DELETE` | admin | editar o eliminar usuarios |
| `/api/admin/login-logs` | `GET`, `DELETE` | admin | consultar o limpiar bitacora de accesos |

## Endpoints protegidos del negocio

| Endpoint | Metodo | Control de acceso principal |
| --- | --- | --- |
| `/api/productivity` | `GET` | sesion, dashboard, lineas, sedes |
| `/api/hourly-analysis` | `GET` | sesion, dashboard, lineas, sedes |
| `/api/margenes` | `GET` | sesion, dashboard, lineas |
| `/api/ingresar-horarios/options` | `GET` | sesion, dashboard, sedes |
| `/api/jornada-extendida/meta` | `GET` | sesion, dashboard, sedes |
| `/api/jornada-extendida/alex-report` | `GET` | sesion, dashboard y `alex` o admin |
| `/api/ventas-x-item` | `GET` | sesion, dashboard |
| `/api/ventas-x-item/v2` | `GET` | sesion, dashboard |

## Doble validacion actual

La app protege el acceso en dos lugares:

### En cliente

- las paginas consultan `/api/auth/me`
- si el usuario no tiene sesion, redirigen a `/login`
- si el usuario no tiene permiso, redirigen a `/tableros`

### En API

- cada endpoint protegido valida sesion
- varios endpoints tambien filtran sedes, lineas y tableros

Esta doble validacion mejora UX, pero la seguridad efectiva depende del backend.

## Headers de seguridad

`next.config.ts` aplica estos headers a todas las rutas:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Resource-Policy`
- `Referrer-Policy`
- `Permissions-Policy`

## Rate limit y cache con impacto en seguridad

| Endpoint | Rate limit observado |
| --- | --- |
| `/api/productivity` | 120 req / min / IP |
| `/api/margenes` | 120 req / min / IP |
| `/api/hourly-analysis` | 120 req / min / IP |
| `/api/ventas-x-item` | 90 req / min / IP |
| `/api/ventas-x-item/v2` | 120 req / min / IP |

Notas:

- la implementacion es en memoria del proceso
- no es compartida entre replicas
- no se observo rate limit explicito sobre login

## Riesgos y consideraciones

- No hay `middleware.ts` central para auth.
- No se identifico un proceso documentado de limpieza de sesiones expiradas.
- Existen valores sensibles por defecto en algunos scripts y helpers de DB.
- El permiso funcional depende de datos migrados correctamente en `app_users`.
