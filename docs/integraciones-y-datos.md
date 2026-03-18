# Integraciones y datos

## Objetivo

Documentar las fuentes de datos, endpoints y dependencias tecnicas que alimentan los tableros.

## Resumen

La integracion principal del proyecto es PostgreSQL. No se encontraron APIs HTTP externas de negocio. Cada modulo consulta tablas especificas y realiza normalizaciones manuales de sedes, lineas, nombres de empresa o nombres de columnas.

## Panorama general de integraciones

| Tipo | Integracion | Uso |
| --- | --- | --- |
| Base de datos | PostgreSQL via `pg` | auth, productividad, margenes, horario, ventas x item |
| Archivo local | cache JSON de productividad | fallback/lectura rapida para `/api/productivity` |
| Memoria del proceso | cache del endpoint horario | respuestas y columnas de `/api/hourly-analysis` |
| Librerias cliente | ExcelJS, jsPDF, canvas | exportaciones |
| UI charts | MUI X Charts | visualizacion |

## Integracion principal: PostgreSQL

La app abre un `Pool` compartido desde `src/lib/db.ts` y configura `search_path` mediante `DB_SCHEMA`.

### Dominio auth y administracion

Tablas usadas:

- `app_users`
- `app_user_sessions`
- `app_user_login_logs`

### Dominio productividad

Tablas usadas:

- `ventas_cajas`
- `ventas_fruver`
- `ventas_industria`
- `ventas_carnes`
- `ventas_pollo_pesc`
- `ventas_asadero`
- `asistencia_horas`

### Dominio margenes

Tabla usada:

- `margenes_linea_co_dia`

### Dominio ventas x item

Tablas usadas:

- `ventas_item_diario`
- `ventas_item_cargas`
- `ventas_item_sede_map`

## Modulo por modulo

### Productividad

Endpoint principal:

- `GET /api/productivity`

Fuentes:

- ventas por linea desde tablas `ventas_*`
- horas trabajadas desde `asistencia_horas`

Comportamiento relevante:

- aplica rate limit por IP
- intenta leer primero cache local si existe
- si no hay cache, consulta DB
- si falla la DB y no existe cache, devuelve fallback vacio con mensaje
- filtra por lineas y sedes permitidas segun sesion

Transformaciones observadas:

- mapeo manual de `centro_operacion + empresa_bd -> sede`
- normalizacion manual de sedes de asistencia
- mapeo manual de departamento -> linea

### Analisis por hora

Endpoint:

- `GET /api/hourly-analysis`

Fuentes:

- tablas `ventas_*` para ventas por hora
- `asistencia_horas` para presencia, personas y horas extra

Parametros relevantes:

| Parametro | Uso |
| --- | --- |
| `date` | fecha base obligatoria |
| `sede` | una o varias sedes |
| `line` | linea opcional |
| `bucketMinutes` | 60, 30, 20, 15 o 10 |
| `includePeople` | habilita desglose por persona |
| `overtimeDateStart` | inicio de rango para horas extra |
| `overtimeDateEnd` | fin de rango para horas extra |

Comportamiento relevante:

- cachea respuestas en memoria por combinacion de parametros
- cachea columnas detectadas de `asistencia_horas`
- filtra sedes y lineas segun permisos

### Margenes

Endpoint:

- `GET /api/margenes`

Fuente:

- `margenes_linea_co_dia`

Comportamiento relevante:

- agregacion SQL directa
- rate limit por IP
- filtrado por lineas permitidas
- mapeo manual de empresa + centro -> sede

### Jornada extendida

Endpoints:

- `GET /api/jornada-extendida/meta`
- `GET /api/jornada-extendida/alex-report`
- `GET /api/hourly-analysis`
- `GET /api/ingresar-horarios/options`

Fuente:

- `asistencia_horas`

Uso:

- fechas disponibles
- sedes visibles
- empleados de cajas para apoyo operativo
- reporte Alex por rango
- analisis horario reutilizado desde componente compartido

### Ventas x item

Endpoints:

- `GET /api/ventas-x-item`
- `GET /api/ventas-x-item/v2`

Fuente:

- `ventas_item_diario`

Apoyo:

- `ventas_item_sede_map`
- `ventas_item_cargas`

Comportamiento relevante:

- la UI elige v1 o v2 con `NEXT_PUBLIC_VENTAS_X_ITEM_USE_V2`
- existen modos `meta`, `summary` y en v2 tambien `options`
- la pagina incluye chequeo de paridad entre v1 y v2

Parametros relevantes de v1/v2:

| Parametro | v1 | v2 | Uso |
| --- | --- | --- | --- |
| `start` | si | si | inicio de rango |
| `end` | si | si | fin de rango |
| `mode` | si | si | `meta`, `summary`, y `options` en v2 |
| `empresa` | si | si | filtro por empresa |
| `itemIds` | si | si | filtro por items |
| `itemQuery` | no | si | busqueda libre de item |
| `idCo` | no | si | filtro por centro de operacion |
| `maxRows` | si | si | limite de filas |
| `offset` | si | si | paginacion |
| `optionLimit` | no | si | limite para modo `options` |

## Endpoints y fuente de datos

| Endpoint | Fuente principal | Notas |
| --- | --- | --- |
| `/api/productivity` | `ventas_*`, `asistencia_horas`, cache local | modulo principal |
| `/api/hourly-analysis` | `ventas_*`, `asistencia_horas`, cache memoria | compartido entre modulos |
| `/api/margenes` | `margenes_linea_co_dia` | margenes por linea |
| `/api/ingresar-horarios/options` | `asistencia_horas` | empleados de cajas |
| `/api/jornada-extendida/meta` | `asistencia_horas` | fechas y sedes visibles |
| `/api/jornada-extendida/alex-report` | `asistencia_horas` | reporte agregado |
| `/api/ventas-x-item` | `ventas_item_diario` | version inicial |
| `/api/ventas-x-item/v2` | `ventas_item_diario` | version extendida |

## Exportaciones y dependencias cliente

| Modulo | Exportaciones observadas | Tecnologia |
| --- | --- | --- |
| Productividad | PDF, CSV, XLSX | jsPDF, ExcelJS |
| Analisis horario | XLSX | ExcelJS |
| Jornada extendida | PNG para tabla Alex | canvas |
| Ventas x item | XLSX | ExcelJS |

## Integraciones externas no encontradas

En el codigo revisado no se observaron:

- APIs REST externas
- servicios de autenticacion externos
- colas o brokers
- object storage
- sistemas de monitoreo o telemetria externos

Esto solo describe el codigo versionado; no excluye componentes externos no documentados en el repositorio.

## Riesgos y observaciones

- El sistema depende de varias normalizaciones manuales de sedes, empresas y departamentos.
- Cambios en nombres de columnas dentro de `asistencia_horas` pueden afectar funcionalidades que detectan columnas dinamicamente.
- No se encontro documentacion del proceso que carga `ventas_item_diario`.
- El cache de productividad depende de un archivo cuyo ciclo de vida no esta documentado en el repositorio.
