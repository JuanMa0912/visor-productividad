# Arquitectura

## Objetivo

Describir la forma actual del sistema, sus capas y la relacion entre modulos para facilitar mantenimiento, onboarding y evolucion.

## Resumen

`visor-productividad` es una aplicacion web interna construida con Next.js App Router. La mayor parte de la interfaz esta implementada como paginas cliente que consumen endpoints internos en `src/app/api`. El backend no usa ORM ni una capa service/repository separada; cada route handler ejecuta SQL directo sobre PostgreSQL mediante `pg`.

## Stack

| Capa | Implementacion actual |
| --- | --- |
| Frontend | Next.js 16 + React 19 |
| Lenguaje | TypeScript |
| Estilos | Tailwind CSS 4 |
| UI base | Radix UI + componentes locales |
| Graficos | MUI X Charts |
| Exportacion | ExcelJS, jsPDF, jsPDF AutoTable, canvas |
| Animacion | Anime.js |
| Persistencia | PostgreSQL |
| Auth | sesiones propias en DB |

## Diagrama de alto nivel

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

## Patrones de implementacion observados

- Las paginas funcionales relevantes usan `"use client"`.
- La autenticacion se resuelve en dos pasos:
  - redireccion en cliente via `/api/auth/me`
  - validacion efectiva en los endpoints protegidos
- No se encontro `middleware.ts`.
- No se identifico una capa comun de servicios de dominio.
- Las consultas SQL y la transformacion de datos viven en `route.ts`.

## Modulos funcionales

| Modulo | Rutas principales | Proposito |
| --- | --- | --- |
| Productividad | `/productividad`, `/`, `/productividad/cajas` | ventas, horas, comparativos y analisis por hora |
| Margenes | `/margenes` | rentabilidad por linea y sede |
| Horario | `/horario`, `/jornada-extendida`, `/ingresar-horarios` | consulta de horas y apoyo operativo |
| Ventas x item | `/ventas-x-item` | analisis por item, empresa, centro de operacion y rango |
| Administracion | `/admin/usuarios`, `/cuenta/contrasena` | gestion de usuarios, permisos y contrasenas |

## Mapa de rutas visibles

| Ruta | Funcion |
| --- | --- |
| `/login` | inicio de sesion |
| `/tableros` | selector de tableros visibles segun permisos |
| `/productividad` | hub del modulo de productividad |
| `/` | tablero principal de productividad por linea |
| `/productividad/cajas` | vista dedicada a cajas y horas |
| `/margenes` | tablero de margenes |
| `/horario` | hub del modulo de horario |
| `/jornada-extendida` | consulta de horas trabajadas y reporte Alex |
| `/ingresar-horarios` | captura/formato operativo de horarios |
| `/ventas-x-item` | analisis de ventas por item |
| `/admin/usuarios` | administracion de usuarios y bitacora |
| `/cuenta/contrasena` | cambio de contrasena |

## Componentes y librerias compartidas

### Librerias de base

- `src/lib/auth.ts`: sesiones, cookies, hashing y helpers de autorizacion
- `src/lib/db.ts`: inicializacion del pool PostgreSQL
- `src/lib/constants.ts`: sedes, lineas y agrupaciones visibles
- `src/lib/calc.ts`: calculos de productividad y margen
- `src/lib/ventas-x-item.ts`: normalizacion y pivoteo para ventas por item

### Componentes reutilizados

- `HourlyAnalysis`: usado desde el tablero principal, cajas y jornada extendida
- `TopBar`: encabezado compartido del tablero de productividad
- `LineCard`, `LineComparisonTable`, `SelectionSummary`: piezas del modulo de productividad

## Estructura del backend

Los endpoints viven en `src/app/api` y estan organizados por dominio:

- `auth/*`
- `admin/*`
- `productivity`
- `hourly-analysis`
- `margenes`
- `jornada-extendida/*`
- `ingresar-horarios/options`
- `ventas-x-item/*`

Cada endpoint:

- valida sesion si aplica
- arma SQL directo
- transforma los resultados
- devuelve JSON
- en varios casos refresca la cookie de sesion

## Rutas del sistema y relacion funcional

### Productividad

- El hub `/productividad` deriva a `/` y `/productividad/cajas`.
- `/` concentra la mayor cantidad de logica de visualizacion y exportacion.
- `/productividad/cajas` reutiliza el analisis por hora con foco en la linea cajas.

### Horario

- El permiso funcional usa el id `jornada-extendida`.
- El acceso visible en tableros lleva al hub `/horario`.
- Desde ese hub se navega a:
  - `/jornada-extendida`
  - `/ingresar-horarios`

### Ventas x item

- La UI puede apuntar a v1 o v2 segun `NEXT_PUBLIC_VENTAS_X_ITEM_USE_V2`.
- Existe logica de comparacion de paridad entre ambas versiones.

## Decisiones arquitectonicas visibles

- PostgreSQL es la fuente principal de verdad del negocio.
- No se observan integraciones HTTP externas para negocio.
- Las exportaciones se resuelven en cliente para reducir dependencia de jobs backend.
- Se usan caches simples de proceso o archivo, no distribuidas.

## Limites y deuda tecnica observada

- No hay una separacion fuerte entre capa HTTP, dominio y acceso a datos.
- Parte de la UI y el analisis vive en archivos grandes, especialmente `src/app/page.tsx`.
- La ausencia de middleware obliga a repetir validaciones entre cliente y API.
- La arquitectura actual depende de normalizaciones manuales de sedes, lineas y nombres de columnas.
