# Documentacion tecnica preliminar

Bitacora de levantamiento inicial y registro de vacios todavia no resueltos por codigo.

## Estado

- Tipo: brownfield
- Fuente usada: codigo y scripts versionados en este repositorio
- Fecha base del levantamiento: 2026-03-18
- Documentacion estable derivada de este levantamiento:
  - [README de docs](./README.md)
  - [arquitectura.md](./arquitectura.md)
  - [accesos-y-seguridad.md](./accesos-y-seguridad.md)
  - [integraciones-y-datos.md](./integraciones-y-datos.md)
  - [operacion-local-y-base-de-datos.md](./operacion-local-y-base-de-datos.md)

## Cobertura revisada

Superficie tecnica inspeccionada:

- `package.json`
- `next.config.ts`
- `tsconfig.json`
- `src/lib/*.ts`
- `src/app/**/*.tsx`
- `src/app/api/**/route.ts`
- `db/*.sql`
- `db/migrations/*.sql`
- `scripts/*.js`

Hallazgos estructurales ya consolidados en la nueva documentacion:

- no existe `middleware.ts`
- la validacion de acceso se reparte entre paginas cliente y endpoints API
- la capa backend usa SQL embebido directamente en `route.ts`
- no existe `.env.example`

## Gaps tecnicos abiertos

### Configuracion y seguridad

- Hay valores sensibles por defecto en `src/lib/db.ts` y `test-db-postgres.js`.
- No existe una guia versionada para manejo seguro de variables de entorno.
- No se encontro una estrategia documentada de rotacion o limpieza de sesiones.

### Infraestructura y despliegue

- No se encontro documentacion de despliegue.
- No se encontraron archivos de infraestructura o CI/CD dentro del repositorio revisado.
- No se encontro documentacion de observabilidad, backup o recuperacion.

### Datos e integraciones

- `productivity` puede leer desde un archivo cache local, pero no hay proceso documentado para generarlo o refrescarlo.
- `ventas-x-item` depende de que `ventas_item_diario` ya este cargada; no se encontro ETL o proceso de carga en este repo.
- `ingresar-horarios` carga sedes y empleados, pero no se encontro un endpoint de persistencia.

### Arquitectura

- `src/app/page.tsx` concentra mucha logica de UI y exportacion en un solo archivo.
- El rate limit y las caches en memoria son locales al proceso actual y no distribuidos.
- `db/schema-auth.sql` no alcanza a documentar por si solo todas las columnas usadas por la app; depende de migraciones adicionales.

## Preguntas abiertas para el equipo

1. Cual es el entorno de despliegue real del proyecto?
2. Quien carga y refresca las tablas `ventas_*`, `asistencia_horas`, `margenes_linea_co_dia` y `ventas_item_diario`?
3. Con que frecuencia se actualiza cada fuente y cual es la latencia esperada?
4. Existe un proceso programado para limpiar `app_user_sessions` expiradas?
5. El cache de productividad lo genera un job, un usuario o un proceso externo?
6. `ingresar-horarios` debe persistir informacion o solo funciona como formato operativo?
7. Habra mas roles especiales ademas de `alex`?
8. Existe una politica formal para retencion de `app_user_login_logs`?
9. Como debe comportarse la app en produccion con multiples replicas?
10. Debe documentarse tambien infraestructura y soporte operativo en una segunda fase?

## Recomendacion de siguiente fase

1. Validar entorno de despliegue y variables de entorno reales.
2. Documentar el flujo de carga y actualizacion de datos.
3. Confirmar el alcance funcional de `ingresar-horarios`.
4. Definir un runbook operativo minimo para migraciones, admin y contingencia.
