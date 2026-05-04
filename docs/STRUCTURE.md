# Estructura de código (guía breve)

## `src/lib/`

Código de dominio agrupado por carpetas. Los imports usan el alias `@/lib/...` (ver `tsconfig`).

| Carpeta     | Contenido |
|------------|-----------|
| `auth/`    | Sesión, cookies, CSRF; `index.ts` es el punto de entrada. |
| `db/`      | Pool PostgreSQL; `index.ts` es el punto de entrada. |
| `shared/`  | Utilidades transversas: `constants`, `normalize`, `utils`, `calc`, `portal-sections`, `special-role-features`, `rate-limit`, `export-utils`, `agent-debug-log`. |
| `horarios/` | Planilla, comparación, presets lunes, `schedule-time`, visibilidad de cédulas. |
| `rotacion/` | SQL base, dimensiones de categoría, estados cero rotación. |
| `ventas/`   | Normalización y rango de fechas para ventas por ítem. |
| `inventario/` | Límites y presets de inventario por ítem. |

## `src/app/rotacion/`

- `page.tsx`: componente de página (cliente) y lógica de UI principal.
- `rotacion-preamble.ts`: tipos, constantes y funciones puras de apoyo a la vista (exportaciones nombradas).
- `rotation-filter-widgets.tsx`: subcomponentes de filtros (ordenables, selectores, logo WhatsApp).

## Tests

Los tests unitarios viven junto al código bajo `src/**/*.test.ts` (ver `package.json` → `test:unit`).
