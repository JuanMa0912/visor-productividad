import type { PoolClient } from "pg";
import { productividadFamiliaSqlFast } from "@/lib/proveedores/line-family";

export const PROVEEDOR_LINEA_FILTERS = [
  "todas",
  "industria",
  "fruver",
  "carnes",
] as const;

export type ProveedorLineaFilter = (typeof PROVEEDOR_LINEA_FILTERS)[number];

export const PROVEEDOR_LINEA_FILTER_OPTIONS: Array<{
  id: ProveedorLineaFilter;
  label: string;
}> = [
  { id: "todas", label: "Todas las líneas" },
  { id: "industria", label: "Industria" },
  { id: "fruver", label: "Fruver" },
  { id: "carnes", label: "Carnes" },
];

export const parseProveedorLineaFilter = (
  raw: string | null | undefined,
): ProveedorLineaFilter => {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return (PROVEEDOR_LINEA_FILTERS as readonly string[]).includes(value)
    ? (value as ProveedorLineaFilter)
    : "todas";
};

export const compactToIsoDate = (compact: string): string => {
  if (!/^\d{8}$/.test(compact)) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
};

/** Predicado SQL: familia N1 = filtro (TRUE si "todas"). */
export const proveedorLineaFamiliaSql = (
  lineaIdExpr: string,
  familia: ProveedorLineaFilter,
): string => {
  if (familia === "todas") return "TRUE";
  return `(${productividadFamiliaSqlFast(lineaIdExpr)}) = '${familia}'`;
};

/**
 * Último día con venta de proveedor (ancla de todos los tableros).
 * Compacto YYYYMMDD → ISO, o null si no hay hechos.
 */
export const queryLastProveedoresDataDate = async (
  client: PoolClient,
): Promise<string | null> => {
  const result = await client.query<{ last: string | null }>(
    `
    SELECT max(fecha_dcto) AS last
    FROM ventas_proveedor_dia
    WHERE fecha_dcto ~ '^[0-9]{8}$'
    `,
  );
  const last = result.rows[0]?.last;
  if (!last || !/^\d{8}$/.test(last)) return null;
  return compactToIsoDate(last);
};
