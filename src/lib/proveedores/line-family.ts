import { PROVEEDORES_QR_SEDES } from "@/lib/proveedores/types";
import {
  normalizeKeyCompact,
  normalizeKeySpaced,
} from "@/lib/shared/normalize";

/** Familias pedidas en el tablero Proveedores (no incluye pollo/asadero). */
export type ProveedorProductividadFamilia =
  | "industria"
  | "fruver"
  | "carnes";

export type ProveedorProductividadKpi = ProveedorProductividadFamilia | "cajas";

export type ProveedorProductividadUnidad =
  | "unidades"
  | "kilos"
  | "transacciones";

export const PRODUCTIVIDAD_FAMILIA_META: Record<
  ProveedorProductividadKpi,
  { label: string; unidad: ProveedorProductividadUnidad; short: string }
> = {
  industria: { label: "Industria", unidad: "unidades", short: "und" },
  fruver: { label: "Fruver", unidad: "kilos", short: "kg" },
  carnes: { label: "Carnes", unidad: "kilos", short: "kg" },
  cajas: { label: "Cajas", unidad: "transacciones", short: "tx" },
};

/** N1 Fruver (margen / informe). */
export const FRUVER_LINEA_N1 = "01";
/** N1 Carnes rojas. Pollo (03) y asadero (12) quedan fuera a propósito. */
export const CARNES_LINEA_N1 = "02";
/** Líneas perecederas que no deben mezclarse como “unidades” de industria. */
export const EXCLUDED_PRODUCTIVIDAD_LINEA_N1 = ["03", "12"] as const;

export const normalizeLineaN1 = (raw: string): string => {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(2, "0");
  return trimmed.toLowerCase();
};

const normalizeNombre = (raw: string | null | undefined): string =>
  String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Clasifica línea N1 → familia de productividad de proveedores.
 * `null` = fuera del tablero (pollo, asadero, vacíos).
 */
export const classifyProductividadFamilia = (
  idLinea1: string | null | undefined,
  nombreLinea1?: string | null,
): ProveedorProductividadFamilia | null => {
  const id = normalizeLineaN1(String(idLinea1 ?? ""));
  const nombre = normalizeNombre(nombreLinea1);

  if (id === FRUVER_LINEA_N1 || nombre.includes("fruv")) return "fruver";
  if (id === CARNES_LINEA_N1 || nombre.includes("carn")) return "carnes";
  if (
    (EXCLUDED_PRODUCTIVIDAD_LINEA_N1 as readonly string[]).includes(id) ||
    /pollo|pesc|asad/.test(nombre)
  ) {
    return null;
  }
  if (!id && !nombre) return null;
  return "industria";
};

/**
 * CASE SQL alineado con {@link classifyProductividadFamilia}.
 * Preferir {@link productividadFamiliaSqlFast} en queries calientes (sin LIKE).
 */
export const productividadFamiliaSql = (
  lineaIdExpr: string,
  lineaNombreExpr: string,
): string => `
CASE
  WHEN (
    TRIM(COALESCE(${lineaIdExpr}::text, '')) ~ '^[0-9]+$'
    AND LPAD(TRIM(${lineaIdExpr}::text), 2, '0') = '${FRUVER_LINEA_N1}'
  ) OR LOWER(COALESCE(${lineaNombreExpr}, '')) LIKE '%fruv%'
    THEN 'fruver'
  WHEN (
    TRIM(COALESCE(${lineaIdExpr}::text, '')) ~ '^[0-9]+$'
    AND LPAD(TRIM(${lineaIdExpr}::text), 2, '0') = '${CARNES_LINEA_N1}'
  ) OR LOWER(COALESCE(${lineaNombreExpr}, '')) LIKE '%carn%'
    THEN 'carnes'
  WHEN (
    TRIM(COALESCE(${lineaIdExpr}::text, '')) ~ '^[0-9]+$'
    AND LPAD(TRIM(${lineaIdExpr}::text), 2, '0') IN ('03', '12')
  ) OR LOWER(COALESCE(${lineaNombreExpr}, '')) ~ '(pollo|pesc|asad)'
    THEN NULL
  WHEN NULLIF(TRIM(COALESCE(${lineaIdExpr}::text, '')), '') IS NULL
   AND NULLIF(TRIM(COALESCE(${lineaNombreExpr}, '')), '') IS NULL
    THEN NULL
  ELSE 'industria'
END
`;

/**
 * Variante rápida solo por código N1 (sin LIKE sobre nombre).
 * Tolera `1` / `01`.
 */
export const productividadFamiliaSqlFast = (lineaIdExpr: string): string => `
CASE
  WHEN NULLIF(TRIM(COALESCE(${lineaIdExpr}::text, '')), '') IS NULL THEN NULL
  WHEN (
    TRIM(${lineaIdExpr}::text) ~ '^[0-9]+$'
    AND LPAD(TRIM(${lineaIdExpr}::text), 2, '0') = '${FRUVER_LINEA_N1}'
  ) THEN 'fruver'
  WHEN (
    TRIM(${lineaIdExpr}::text) ~ '^[0-9]+$'
    AND LPAD(TRIM(${lineaIdExpr}::text), 2, '0') = '${CARNES_LINEA_N1}'
  ) THEN 'carnes'
  WHEN (
    TRIM(${lineaIdExpr}::text) ~ '^[0-9]+$'
    AND LPAD(TRIM(${lineaIdExpr}::text), 2, '0') IN ('03', '12')
  ) THEN NULL
  ELSE 'industria'
END
`;

export type ProveedorTiendaSede = {
  name: (typeof PROVEEDORES_QR_SEDES)[number];
  empresa: "mercamio" | "mtodo" | "bogota";
  idCo: string;
};

/** Tiendas del tablero (sin Dinastía ni plantas). */
export const PROVEEDORES_TIENDA_SEDES: readonly ProveedorTiendaSede[] = [
  { name: "Calle 5ta", empresa: "mercamio", idCo: "001" },
  { name: "La 39", empresa: "mercamio", idCo: "002" },
  { name: "Plaza Norte", empresa: "mercamio", idCo: "003" },
  { name: "Ciudad Jardin", empresa: "mercamio", idCo: "004" },
  { name: "Centro Sur", empresa: "mercamio", idCo: "005" },
  { name: "Palmira", empresa: "mercamio", idCo: "006" },
  { name: "Floresta", empresa: "mtodo", idCo: "001" },
  { name: "Floralia", empresa: "mtodo", idCo: "002" },
  { name: "Guaduales", empresa: "mtodo", idCo: "003" },
  { name: "Bogota", empresa: "bogota", idCo: "001" },
  { name: "Chia", empresa: "bogota", idCo: "002" },
] as const;

const SEDE_BY_KEY = new Map(
  PROVEEDORES_TIENDA_SEDES.map((sede) => [`${sede.empresa}|${sede.idCo}`, sede]),
);

const SEDE_BY_NAME = new Map(
  PROVEEDORES_TIENDA_SEDES.map((sede) => [normalizeKeyCompact(sede.name), sede]),
);

export const normalizeEmpresaBd = (raw: string): string => {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "mercatodo") return "mtodo";
  if (value === "merkmios") return "bogota";
  return value;
};

export const resolveTiendaSede = (
  empresa: string,
  idCo: string,
): ProveedorTiendaSede | null => {
  const key = `${normalizeEmpresaBd(empresa)}|${String(idCo ?? "").trim().padStart(3, "0")}`;
  return SEDE_BY_KEY.get(key) ?? null;
};

export const findTiendaSedeByName = (
  sedeName: string,
): ProveedorTiendaSede | null =>
  SEDE_BY_NAME.get(normalizeKeyCompact(sedeName)) ?? null;

/**
 * Alias libres de `asistencia_horas.sede` → tienda del tablero.
 * Misma familia de nombres que hourly-analysis / productividad $.
 */
const ASISTENCIA_SEDE_ALIASES: Record<string, string> = {
  "la 5a": "Calle 5ta",
  "calle 5a": "Calle 5ta",
  "calle 5ta": "Calle 5ta",
  "la 5": "Calle 5ta",
  "la 39": "La 39",
  "mio plaza norte": "Plaza Norte",
  "plaza norte": "Plaza Norte",
  "ciudad jardin": "Ciudad Jardin",
  "centro sur": "Centro Sur",
  "palmira mercamio": "Palmira",
  palmira: "Palmira",
  floresta: "Floresta",
  floralia: "Floralia",
  "floralia mercatodo": "Floralia",
  "mercatodo floralia": "Floralia",
  guaduales: "Guaduales",
  "merkmios bogota": "Bogota",
  bogota: "Bogota",
  "merkmios chia": "Chia",
  chia: "Chia",
};

/** Resuelve sede de asistencia al catálogo de tiendas (o null si no aplica). */
export const resolveTiendaSedeFromAsistencia = (
  sedeRaw: string,
): ProveedorTiendaSede | null => {
  const direct = findTiendaSedeByName(sedeRaw);
  if (direct) return direct;
  const key = normalizeKeySpaced(sedeRaw);
  if (!key) return null;
  const aliasName = ASISTENCIA_SEDE_ALIASES[key];
  if (aliasName) return findTiendaSedeByName(aliasName);
  // Contiene: "merkmios bogota centro" etc.
  for (const [alias, name] of Object.entries(ASISTENCIA_SEDE_ALIASES)) {
    if (key.includes(alias) || alias.includes(key)) {
      const hit = findTiendaSedeByName(name);
      if (hit) return hit;
    }
  }
  return null;
};

export const isProveedoresProductividadSede = (sede: string): boolean =>
  findTiendaSedeByName(sede) != null;
