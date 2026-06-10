# Contribuir

Guia breve para preparar cambios en este repositorio.

## Setup local

```bash
npm install
cp .env.example .env.local
npm run db:test
node scripts/create-admin.js
npm run dev
```

No subir `.env.local`. Ajustar credenciales reales solo en el entorno local o
del servidor.

## Flujo de trabajo

1. Revisa `README.md`, `docs/STRUCTURE.md` y `docs/DATABASE.md` si vas a tocar
   rutas, APIs, permisos o datos.
2. Mantiene el cambio pequeno y enfocado.
3. Agrega o actualiza tests cuando toques reglas faciles de romper: fechas,
   permisos, parsers, agregados, normalizadores o endpoints compartidos.
4. Actualiza documentacion si cambia comportamiento observable, migraciones,
   variables de entorno, despliegue o integraciones.
5. Ejecuta validaciones antes de abrir PR.

## Validacion

Comandos principales:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run ci
```

`npm run ci` ejecuta lint, typecheck, tests unitarios y build. El workflow de
GitHub corre en Pull Requests hacia `main` y manualmente por `workflow_dispatch`.

## Base de datos

- Aplicar primero `db/schema-auth.sql` y luego migraciones de `db/migrations/`
  en orden por fecha.
- Para aplicar un archivo puntual:

```bash
node scripts/apply-migration-file.mjs db/migrations/NOMBRE.sql
```

- Si agregas una migracion, actualiza `README.md`, `docs/STRUCTURE.md` y
  `docs/DATABASE.md`.
- No documentes como versionado un DDL que solo existe en produccion/ETL; marcala
  como dependencia externa si no esta en el repo.

## Seguridad y secretos

- Nunca subir `.env.local`, passwords, tokens, dumps sensibles ni logs locales.
- Las consultas SQL deben ser parametrizadas.
- Cada API protegida debe validar sesion/permisos; `src/proxy.ts` solo cubre el
  borde de navegacion.
- Cambios de CSP, cookies, CSRF, auth o permisos requieren revision cuidadosa y
  pruebas explicitas.

## Pull Requests

Usar `.github/pull_request_template.md`:

- completar resumen;
- marcar validaciones ejecutadas;
- anotar comandos no ejecutados y por que;
- mencionar migraciones o variables nuevas;
- incluir notas de despliegue cuando aplique.

## Archivos generados

`.gitignore` cubre `.next/`, `node_modules/`, `.env*` salvo `.env.example`,
`*.tsbuildinfo`, `data/productivity-cache.json`, `data/debug/` y logs
`.next-dev*.log`. Si aparece un generado nuevo, actualizar `.gitignore` antes
de que entre al repo.
