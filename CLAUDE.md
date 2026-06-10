# CLAUDE.md

Compatibilidad para Claude Code.

La politica canonica del repositorio esta en [`AGENTS.md`](AGENTS.md). Sigue ese
archivo primero para comandos, seguridad, permisos, documentacion y limites de
edicion.

Fuentes tecnicas de apoyo:

- [`README.md`](README.md)
- [`docs/STRUCTURE.md`](docs/STRUCTURE.md)
- [`docs/DATABASE.md`](docs/DATABASE.md)
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`CONTRIBUTING.md`](CONTRIBUTING.md)

Resumen minimo:

- Next.js 16 + React 19 + Tailwind 4 + TypeScript.
- PostgreSQL via `pg`, sin ORM.
- Auth propia con cookies `vp_session` y `vp_csrf`.
- Antes de cerrar cambios de codigo, intenta ejecutar `npm run ci`.
- No tocar `.env.local`, secretos, logs locales ni cambios ajenos del usuario sin
  instruccion explicita.

Estilo esperado: pensamiento critico util. Empieza por huecos, riesgos y
supuestos debiles; no valides automaticamente una idea sin evidencia del repo o
fuentes oficiales.
