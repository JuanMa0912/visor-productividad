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

/** Día calendario de visitas QR (mismo huso que el agrupado por día). */
export const PROVEEDORES_VISITAS_TZ = "America/Bogota";

export type ProveedoresVisitasFilterArgs = {
  dateStart: string;
  dateEnd: string;
  sedeName?: string | null;
  q?: string | null;
};

/**
 * Día de entrada en calendario Colombia, igual que el GROUP BY "por día".
 * No usa `T00:00:00` (eso se interpreta en el TimeZone de la sesión).
 */
export const proveedoresVisitasEntradaRangeSql = (
  fromParam: number,
  toParam: number,
) =>
  `(entrada_at AT TIME ZONE '${PROVEEDORES_VISITAS_TZ}')::date >= $${fromParam}::date AND (entrada_at AT TIME ZONE '${PROVEEDORES_VISITAS_TZ}')::date <= $${toParam}::date`;

/** WHERE + params de asistencia: día(s) Bogotá, sede explícita y búsqueda. */
export const buildProveedoresVisitasFilter = (
  args: ProveedoresVisitasFilterArgs,
) => {
  const params: unknown[] = [args.dateStart, args.dateEnd];
  const clauses = [proveedoresVisitasEntradaRangeSql(1, 2)];
  const sedeName = (args.sedeName ?? "").trim();
  if (sedeName) {
    params.push(sedeName);
    clauses.push(`sede_name = $${params.length}`);
  }
  const q = (args.q ?? "").trim().slice(0, 80);
  if (q) {
    params.push(`%${q.replace(/[%_]/g, "")}%`);
    const idx = params.length;
    clauses.push(
      `(proveedor_nombre ILIKE $${idx} OR visitante_nombre ILIKE $${idx} OR visitante_cedula ILIKE $${idx} OR COALESCE(proveedor_codigo, '') ILIKE $${idx})`,
    );
  }
  return { params, whereSql: clauses.join(" AND ") };
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
