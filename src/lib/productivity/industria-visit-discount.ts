import type { Pool } from "pg";
import { PROVEEDORES_TIENDA_SEDES } from "@/lib/proveedores/line-family";
import { listQrVisitasTablePairs } from "@/lib/proveedores/qr-tables";
import type { LineMetrics } from "@/types";

/** Sube cache memoria/disco: Industria ya no incluye visitas QR del día. */
export const PRODUCTIVITY_VOLUME_SCHEMA = 4;

const QR_TABLE_RE = /^qr_[a-z0-9_]+$/;
const SENTINEL_NITS = new Set(["", "0", "99999999"]);

export type IndustriaVisitDiscountRow = {
  fechaDcto: string;
  empresaNorm: string;
  idCoNorm: string;
  qty: number;
};

export const digitsOnlyNit = (raw: string): string =>
  String(raw ?? "").replace(/\D/g, "");

export const isUsableProveedorNit = (raw: string): boolean => {
  const digits = digitsOnlyNit(raw);
  return digits.length >= 5 && !SENTINEL_NITS.has(digits);
};

/** UNION de tablas QR (whitelist) con empresa/CO de la tienda. */
export const buildQrVisitasUnionSql = (): string | null => {
  const parts: string[] = [];
  for (const { sedeName, table } of listQrVisitasTablePairs()) {
    if (!QR_TABLE_RE.test(table)) continue;
    const tienda = PROVEEDORES_TIENDA_SEDES.find((sede) => sede.name === sedeName);
    if (!tienda) continue;
    const empresa = tienda.empresa.replace(/'/g, "");
    const idCo = tienda.idCo.replace(/'/g, "");
    parts.push(`
      SELECT entrada_at, proveedor_codigo,
             '${empresa}'::text AS sede_empresa,
             '${idCo}'::text AS sede_id_co
      FROM ${table}
    `);
  }
  if (parts.length === 0) return null;
  return `(\n${parts.join("\nUNION ALL\n")}\n) AS visitas_qr`;
};

const nitSql = (expr: string) =>
  `regexp_replace(btrim(COALESCE(${expr}, '')), '[^0-9]', '', 'g')`;

const buildDiscountSql = (fromCompact: string | null, toCompact: string | null) => {
  const visitasSql = buildQrVisitasUnionSql();
  if (!visitasSql) return null;

  const params: string[] = [];
  const visitDateWhere: string[] = [`btrim(COALESCE(proveedor_codigo, '')) <> ''`];
  const rollDateWhere: string[] = [
    `TRIM(COALESCE(r.id_tipo, '')) = '4'`,
    `LPAD(TRIM(COALESCE(r.id_linea1, '')), 2, '0') NOT IN ('01', '02', '03', '04')`,
    `btrim(COALESCE(pi.id_cricla1, '')) <> ''`,
    `btrim(pi.id_cricla1) <> '@SP'`,
  ];
  if (fromCompact) {
    params.push(fromCompact);
    visitDateWhere.push(
      `to_char((entrada_at AT TIME ZONE 'America/Bogota')::date, 'YYYYMMDD') >= $${params.length}`,
    );
    rollDateWhere.push(`r.fecha_dcto >= $${params.length}`);
  }
  if (toCompact) {
    params.push(toCompact);
    visitDateWhere.push(
      `to_char((entrada_at AT TIME ZONE 'America/Bogota')::date, 'YYYYMMDD') <= $${params.length}`,
    );
    rollDateWhere.push(`r.fecha_dcto <= $${params.length}`);
  }

  const sql = `
    WITH visits AS (
      SELECT DISTINCT
        to_char((entrada_at AT TIME ZONE 'America/Bogota')::date, 'YYYYMMDD') AS fecha_dcto,
        sede_empresa,
        sede_id_co,
        upper(btrim(proveedor_codigo)) AS codigo
      FROM ${visitasSql}
      WHERE ${visitDateWhere.join("\n        AND ")}
    ),
    visit_cricla AS (
      SELECT fecha_dcto, sede_empresa, sede_id_co, codigo AS id_cricla1
      FROM visits
      UNION
      SELECT
        v.fecha_dcto,
        v.sede_empresa,
        v.sede_id_co,
        upper(btrim(pc.id_cricla1)) AS id_cricla1
      FROM visits v
      INNER JOIN proveedor_tercero pt
        ON upper(btrim(pt.codigo)) = v.codigo
       AND length(${nitSql("pt.nit")}) >= 5
       AND ${nitSql("pt.nit")} NOT IN ('0', '99999999')
      INNER JOIN proveedor_pos_catalogo pc
        ON ${nitSql("pc.nit")} = ${nitSql("pt.nit")}
       AND btrim(COALESCE(pc.id_cricla1, '')) <> ''
       AND btrim(pc.id_cricla1) <> '@SP'
    )
    SELECT
      r.fecha_dcto,
      r.empresa_norm,
      r.id_co_norm,
      SUM(COALESCE(r.cantidad, 0))::float8 AS qty
    FROM margen_item_dia_roll r
    INNER JOIN proveedor_item pi
      ON pi.empresa = r.empresa_norm
     AND pi.id_item = r.id_item
    INNER JOIN visit_cricla vc
      ON vc.fecha_dcto = r.fecha_dcto
     AND lower(btrim(vc.sede_empresa)) = lower(btrim(r.empresa_norm))
     AND lpad(btrim(vc.sede_id_co), 3, '0') = lpad(btrim(r.id_co_norm), 3, '0')
     AND upper(btrim(pi.id_cricla1)) = vc.id_cricla1
    WHERE ${rollDateWhere.join("\n      AND ")}
    GROUP BY r.fecha_dcto, r.empresa_norm, r.id_co_norm
  `;
  return { sql, params };
};

export const queryIndustriaVisitDiscount = async (
  pool: Pick<Pool, "query">,
  fromCompact: string | null,
  toCompact: string | null,
): Promise<IndustriaVisitDiscountRow[]> => {
  const built = buildDiscountSql(fromCompact, toCompact);
  if (!built) return [];
  try {
    const result = await pool.query<{
      fecha_dcto: string;
      empresa_norm: string;
      id_co_norm: string;
      qty: string | number;
    }>(built.sql, built.params);
    return (result.rows ?? [])
      .map((row) => ({
        fechaDcto: String(row.fecha_dcto ?? ""),
        empresaNorm: String(row.empresa_norm ?? ""),
        idCoNorm: String(row.id_co_norm ?? ""),
        qty: Number(row.qty) || 0,
      }))
      .filter((row) => row.fechaDcto && row.qty > 0);
  } catch (error) {
    console.warn(
      "[productivity] No se pudo descontar Industria por visitas QR:",
      error,
    );
    return [];
  }
};

export const applyIndustriaVisitDiscount = (
  rows: IndustriaVisitDiscountRow[],
  resolveLine: (fechaIso: string, sedeName: string) => LineMetrics | undefined,
  formatDate: (compact: string) => string,
  sedeNameFromRoll: (idCo: string, empresa: string) => string,
): void => {
  for (const row of rows) {
    const fecha = formatDate(row.fechaDcto);
    const sedeName = sedeNameFromRoll(row.idCoNorm, row.empresaNorm);
    const line = resolveLine(fecha, sedeName);
    if (!line || line.id !== "industria") continue;
    line.volume = Math.max(0, (line.volume ?? 0) - row.qty);
  }
};
