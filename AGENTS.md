# AGENTS.md

Instrucciones canonicas para agentes de codigo en este repositorio.

## Fuente de verdad

Lee estos documentos antes de hacer cambios amplios:

- `README.md`: vision general, modulos, permisos, entorno y comandos.
- `docs/STRUCTURE.md`: mapa de codigo, rutas UI/API y convenciones.
- `docs/DATABASE.md`: tablas, migraciones e indices.
- `docs/DEPLOYMENT.md`: despliegue Linux y operacion.
- `CONTRIBUTING.md`: flujo humano de setup, validacion y PR.

`CLAUDE.md` es una superficie de compatibilidad para Claude Code y debe apuntar
a este archivo. No dupliques reglas extensas entre ambos.

## Contexto minimo

- Next.js 16 App Router + React 19 + Tailwind 4 + TypeScript.
- PostgreSQL via `pg`; no hay ORM.
- Auth propia con cookies `vp_session` y `vp_csrf`.
- El borde esta en `src/proxy.ts`, pero cada API protegida debe validar sesion y permisos.
- La mayoria de datos de negocio vienen de PostgreSQL; `/cronograma` usa Notion y `/ExcelDian` usa bases PostgreSQL separadas.

## Comandos

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm run ci
npm run db:test
npm run db:test:postgres
```

Antes de cerrar cambios de codigo, ejecutar `npm run ci` cuando sea viable. Si
no es viable por entorno, reportar el comando y el error exacto.

## Siempre

- Inspecciona el codigo real antes de afirmar rutas, variables, firmas o nombres de migracion.
- Mantiene cambios acotados al dominio solicitado.
- Usa `src/lib/shared/portal-sections.ts` y `src/lib/shared/special-role-features.ts` para permisos.
- Valida input de APIs con patrones existentes y usa SQL parametrizado.
- Actualiza docs si cambian rutas, permisos, migraciones, variables de entorno, despliegue o integraciones.
- Protege `.env.local` y secretos; nunca los imprimas ni los copies a docs.
- Respeta cambios existentes del usuario en el worktree.

## Pregunta primero

- Antes de borrar datos, migraciones, tablas o archivos trackeados que no sean claramente generados.
- Antes de cambiar comportamiento de seguridad, CSP, cookies, auth o permisos.
- Antes de reemplazar `.agents/`, crear `.cursor` o modificar compatibilidad de herramientas.
- Antes de actualizar dependencias principales o cambiar versiones de framework.

## Nunca

- No hagas `git reset --hard`, `git checkout --` ni reverts amplios sin orden explicita.
- No interpolar input de usuario en SQL.
- No asumir que `src/proxy.ts` autoriza una API.
- No tocar `.env.local` salvo peticion explicita.
- No versionar logs locales, `.next/`, caches o secretos.
- No inventar documentacion de procesos ETL que no esten en el repo; marcarlos como vacios conocidos.

## Seguridad

- Cookies: `SESSION_COOKIE_SECURE=true` con HTTPS; `false` solo como excepcion HTTP temporal.
- IP real detras de proxy: requiere `TRUST_PROXY=true` y headers correctos.
- Rate limits actuales viven en memoria del proceso; no son multi-replica.
- CSRF existe para mutaciones que usan `verifyCsrf`; conserva ese patron.
- Cualquier cambio de CSP debe revisarse contra `next.config.ts` y exportaciones Excel/PDF.

## Documentacion

Para cambios documentales:

- Mantener idioma principal en espanol tecnico.
- Preferir comandos copy-ready.
- Validar links locales y rutas mencionadas.
- Evitar duplicar listas largas si ya viven en `docs/STRUCTURE.md` o `docs/DATABASE.md`.
- Mantener `README.md` como entrada de alto nivel, no como inventario exhaustivo de cada handler.

## Estilo de colaboracion

Se directo y critico de forma util. No valides automaticamente decisiones del
usuario: identifica huecos, riesgos y supuestos debiles primero. Si estas de
acuerdo, aporta una condicion, mejora o verificacion concreta.
