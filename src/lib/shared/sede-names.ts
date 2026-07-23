/**
 * Catalogo canonico de nombres de sede por `(sede_id, empresa)`.
 *
 * Fuente de verdad para mostrar los nombres "lindos" en la UI cuando la
 * columna `nombre_sede` de la base viene NULL, vacia o como un literal pobre
 * (ej. el mismo ID "001"). Usalo via `getCanonicalSedeName(...)`.
 *
 * Historicamente este mapeo esta duplicado en:
 *   - src/app/api/productivity/route.ts (SEDE_NAMES)
 *   - src/app/api/hourly-analysis/route.ts (SEDE_CONFIGS, ademas con aliases
 *     y nombres como aparecen en asistencia)
 *
 * Pendiente: consolidar esas 3 copias para que dependan de esta tabla y
 * dejar un solo lugar donde mantener el catalogo cuando se abra una sede
 * nueva.
 */

/**
 * Empresas tal como aparecen en `rotacion_base_item_dia_sede.empresa` y en
 * `centros_operacion.empresa_bd` (ya normalizadas a minusculas + trim).
 *
 *   - "mercamio"  → Mercamio (sedes 001..006 + plantas 997..999)
 *   - "mtodo"     → Mercatodo (alias historico en BD; en otras pantallas
 *                   aparece como "mercatodo")
 *   - "bogota"    → Merkmios (alias historico en BD; la empresa real es
 *                   "merkmios", pero las primeras importaciones la guardaron
 *                   con el nombre del primer centro)
 */
const SEDE_NAME_BY_KEY: Record<string, string> = {
  // ── Mercamio ─────────────────────────────────────────────────────────────
  "001|mercamio": "Calle 5ta",
  "002|mercamio": "La 39",
  "003|mercamio": "Plaza Norte",
  "004|mercamio": "Ciudad Jardín",
  "005|mercamio": "Centro Sur",
  "006|mercamio": "Palmira",
  // Plantas de produccion (centros internos, no son tienda)
  "997|mercamio": "Planta Desprese Pollo",
  "998|mercamio": "Panificadora",
  "999|mercamio": "Planta Desposte Mixto",

  // ── Mercatodo (alias BD: "mtodo") ────────────────────────────────────────
  "001|mtodo": "Floresta",
  "002|mtodo": "Floralia",
  "003|mtodo": "Guaduales",
  // Tolerancia por si en algun feed la empresa viene escrita completa.
  "001|mercatodo": "Floresta",
  "002|mercatodo": "Floralia",
  "003|mercatodo": "Guaduales",

  // ── Merkmios (alias BD: "bogota") ────────────────────────────────────────
  "001|bogota": "Bogotá",
  "002|bogota": "Chía",
  "001|merkmios": "Bogotá",
  "002|merkmios": "Chía",

  // ── Dinastía (GCP: rotacion_dinastia.nombre_sede) ────────────────────────
  "001|dinastia": "Dinastia 1 Santa Elena",
  "002|dinastia": "Dinastia 2 CR Primera",
};

/**
 * Empresas canónicas para filtros de inventario/rotación (códigos BD).
 * Excluye alias (`mercatodo`, `merkmios`) para no duplicar en el dropdown.
 */
export const INVENTARIO_CANONICAL_EMPRESAS = [
  "mercamio",
  "mtodo",
  "bogota",
  "dinastia",
] as const;

export type InventarioCanonicalEmpresa =
  (typeof INVENTARIO_CANONICAL_EMPRESAS)[number];

export const isInventarioCanonicalEmpresa = (
  value: string,
): value is InventarioCanonicalEmpresa =>
  (INVENTARIO_CANONICAL_EMPRESAS as readonly string[]).includes(value);

/**
 * Semilla de sedes por empresa para el dropdown de inventario-x-item.
 * Garantiza que Comercializadora (mtodo) y Merkmios (bogota) existan aunque
 * el corte diario de BD venga incompleto o el cache de proceso este viejo.
 */
export const listCanonicalInventarioFilterSedes = (): Array<{
  empresa: string;
  sedeId: string;
  sedeName: string;
}> => {
  const rows: Array<{ empresa: string; sedeId: string; sedeName: string }> = [];
  for (const [key, sedeName] of Object.entries(SEDE_NAME_BY_KEY)) {
    const separator = key.indexOf("|");
    if (separator <= 0) continue;
    const sedeId = key.slice(0, separator);
    const empresa = key.slice(separator + 1);
    if (!isInventarioCanonicalEmpresa(empresa)) continue;
    rows.push({ empresa, sedeId, sedeName });
  }
  return rows;
};

/**
 * Devuelve el nombre canonico de una sede dado su `(sedeId, empresa)`.
 * Retorna `null` si la combinacion no esta en el catalogo (caller decide el
 * fallback: dejar el `sede_name` que vino de la DB, mostrar el ID, etc.).
 *
 * Las claves se comparan en minusculas y sin espacios extra para tolerar
 * variaciones de casing en la DB.
 */
export const getCanonicalSedeName = (
  sedeId: string | null | undefined,
  empresa: string | null | undefined,
): string | null => {
  if (!sedeId || !empresa) return null;
  const key = `${sedeId.trim()}|${empresa.trim().toLowerCase()}`;
  return SEDE_NAME_BY_KEY[key] ?? null;
};
