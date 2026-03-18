# Visor de Productividad

Aplicacion web interna en Next.js para consultar tableros operativos de productividad, margenes, horario y ventas por item para Mercamio, Mercatodo y Merkmios.

## Documentacion

La documentacion tecnica del proyecto quedo separada por dominio en `docs/`:

- [docs/README.md](docs/README.md)
- [docs/arquitectura.md](docs/arquitectura.md)
- [docs/accesos-y-seguridad.md](docs/accesos-y-seguridad.md)
- [docs/integraciones-y-datos.md](docs/integraciones-y-datos.md)
- [docs/operacion-local-y-base-de-datos.md](docs/operacion-local-y-base-de-datos.md)
- [docs/documentacion-tecnica-preliminar.md](docs/documentacion-tecnica-preliminar.md)

El archivo preliminar conserva hallazgos y preguntas abiertas; los demas documentos son la referencia tecnica principal.

## Modulos actuales

- `Productividad`: tablero principal por linea en `/` y hub en `/productividad`
- `Cajas`: subtablero de productividad en `/productividad/cajas`
- `Margenes`: tablero en `/margenes`
- `Horario`: hub en `/horario`, consulta en `/jornada-extendida` y apoyo operativo en `/ingresar-horarios`
- `Ventas x item`: tablero en `/ventas-x-item`
- `Administracion`: gestion de usuarios en `/admin/usuarios`

## Stack

- Next.js 16 + React 19 + TypeScript
- App Router (`src/app`)
- PostgreSQL via `pg`
- Tailwind CSS 4
- MUI Charts, ExcelJS, jsPDF, Anime.js

## Ejecucion local

Instalar dependencias:

```bash
npm install
```

Levantar ambiente de desarrollo:

```bash
npm run dev
```

Validaciones disponibles:

```bash
npm run lint
npm run build
```

## Base de datos

La aplicacion depende de una base PostgreSQL. Los scripts y migraciones disponibles estan en `db/` y `scripts/`.

Archivos relevantes:

- `db/schema-auth.sql`
- `db/migrations/*.sql`
- `scripts/create-admin.js`
- `test-db.js`
- `test-db-postgres.js`

Antes de ejecutar localmente conviene revisar `docs/operacion-local-y-base-de-datos.md` porque hoy no existe un `.env.example` y hay valores por defecto sensibles definidos en codigo.
