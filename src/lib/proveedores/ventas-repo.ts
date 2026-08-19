import type { PoolClient } from "pg";
import {
  parseProveedorLineaFilter,
  type ProveedorLineaFilter,
} from "@/lib/proveedores/board-filters";
import { resolveTiendaSede } from "@/lib/proveedores/line-family";
import {
  listMargenLineaByDay,
  listMargenLineaBySede,
  listMargenLineaProveedorAgg,
} from "@/lib/proveedores/margen-linea";
import { PROVEEDORES_QR_SEDES } from "@/lib/proveedores/types";

export type ProveedorVentasRow = {
  proveedor: string;
  codigo: string | null;
  unidades: number;
  ventaNeta: number;
  ventaConImpuesto: number;
  items: number;
  sedesActivas: number;
};

export type ProveedorVentasMetrics = {
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  proveedores: number;
  unidadesTotal: number;
  ventaNetaTotal: number;
  ventaConImpuestoTotal: number;
  ticketPromedioNeta: number | null;
  top1SharePct: number | null;
  top10SharePct: number | null;
};

export type ProveedorVentasBySede = {
  sede: string;
  ventaNeta: number;
  unidades: number;
  proveedores: number;
};

export type ProveedorVentasByDay = {
  fecha: string;
  ventaNeta: number;
  unidades: number;
  proveedores: number;
};

const moneyNum = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const compactToIso = (compact: string) => {
  if (!/^\d{8}$/.test(compact)) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
};

/** Alias de sede en ventas_proveedor_dia vs nombres del portal. */
const sedeFilterAliases = (sedePortal: string): string[] => {
  const map: Record<string, string[]> = {
    "Calle 5ta": ["%calle 5%", "%5ta%", "%la 5%", "%cl 5%", "%cl5%"],
    "La 39": ["%39%", "%cra 39%"],
    "Plaza Norte": ["%plaza norte%"],
    "Ciudad Jardin": ["%jardin%", "%ciudad jardin%"],
    "Centro Sur": ["%centro sur%"],
    Palmira: ["%palmira%"],
    Floresta: ["%floresta%"],
    Floralia: ["%floralia%"],
    Guaduales: ["%guaduales%"],
    Bogota: ["%bogota%", "%bogotá%", "%la 80%", "%cl 80%"],
    Chia: ["%chia%", "%chía%"],
  };
  return map[sedePortal] ?? [`%${sedePortal}%`];
};

const resolveWindow = async (
  client: PoolClient,
  days: number,
): Promise<{ fechaInicio: string; fechaFin: string; dias: number }> => {
  const cappedDays = Math.min(Math.max(Math.floor(days), 1), 90);
  const result = await client.query<{ fecha_fin: string | null }>(
    `
    SELECT max(fecha_dcto) AS fecha_fin
    FROM ventas_proveedor_dia
    WHERE fecha_dcto ~ '^[0-9]{8}$'
    `,
  );
  const fechaFin = result.rows[0]?.fecha_fin;
  if (!fechaFin) {
    return { fechaInicio: "", fechaFin: "", dias: cappedDays };
  }
  const end = new Date(
    Number(fechaFin.slice(0, 4)),
    Number(fechaFin.slice(4, 6)) - 1,
    Number(fechaFin.slice(6, 8)),
    12,
    0,
    0,
    0,
  );
  const start = new Date(end);
  start.setDate(start.getDate() - (cappedDays - 1));
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, "0");
  const d = String(start.getDate()).padStart(2, "0");
  return {
    fechaInicio: `${y}${m}${d}`,
    fechaFin,
    dias: cappedDays,
  };
};

const emptyVentas = (
  days: number,
  fechaInicio = "",
  fechaFin = "",
): {
  metrics: ProveedorVentasMetrics;
  rows: ProveedorVentasRow[];
  bySede: ProveedorVentasBySede[];
  byDay: ProveedorVentasByDay[];
} => ({
  metrics: {
    fechaInicio,
    fechaFin,
    dias: days,
    proveedores: 0,
    unidadesTotal: 0,
    ventaNetaTotal: 0,
    ventaConImpuestoTotal: 0,
    ticketPromedioNeta: null,
    top1SharePct: null,
    top10SharePct: null,
  },
  rows: [],
  bySede: [],
  byDay: [],
});

export const listVentasProveedorRolling = async (
  client: PoolClient,
  args: {
    days?: number;
    sede?: string | null;
    q?: string | null;
    linea?: ProveedorLineaFilter | string | null;
    limit?: number;
  } = {},
): Promise<{
  metrics: ProveedorVentasMetrics;
  rows: ProveedorVentasRow[];
  bySede: ProveedorVentasBySede[];
  byDay: ProveedorVentasByDay[];
}> => {
  const linea = parseProveedorLineaFilter(args.linea);
  const window = await resolveWindow(client, args.days ?? 1);
  if (!window.fechaFin) {
    return emptyVentas(args.days ?? 1);
  }

  if (linea !== "todas") {
    const limit = Math.min(Math.max(args.limit ?? 500, 1), 2000);
    const agg = await listMargenLineaProveedorAgg(client, {
      fechaInicioCompact: window.fechaInicio,
      fechaFinCompact: window.fechaFin,
      linea,
      sede: args.sede,
      q: args.q,
      limit,
    });
    const rows: ProveedorVentasRow[] = agg.map((row) => ({
      proveedor: row.proveedor,
      codigo: row.codigo,
      unidades: row.unidades,
      ventaNeta: row.ventaNeta,
      ventaConImpuesto: row.ventaNeta,
      items: row.items,
      sedesActivas: row.sedesActivas,
    }));
    const ventaNetaTotal = rows.reduce((sum, row) => sum + row.ventaNeta, 0);
    const unidadesTotal = rows.reduce((sum, row) => sum + row.unidades, 0);
    const proveedores = rows.length;
    const ranked = [...rows].sort((a, b) => b.ventaNeta - a.ventaNeta);
    const top1 = ranked[0]?.ventaNeta ?? 0;
    const top10 = ranked.slice(0, 10).reduce((sum, row) => sum + row.ventaNeta, 0);
    const [bySedeRaw, byDayRaw] = await Promise.all([
      listMargenLineaBySede(client, {
        fechaInicioCompact: window.fechaInicio,
        fechaFinCompact: window.fechaFin,
        linea,
        sede: args.sede,
      }),
      listMargenLineaByDay(client, {
        fechaInicioCompact: window.fechaInicio,
        fechaFinCompact: window.fechaFin,
        linea,
        sede: args.sede,
      }),
    ]);
    return {
      metrics: {
        fechaInicio: compactToIso(window.fechaInicio),
        fechaFin: compactToIso(window.fechaFin),
        dias: window.dias,
        proveedores,
        unidadesTotal,
        ventaNetaTotal,
        ventaConImpuestoTotal: ventaNetaTotal,
        ticketPromedioNeta:
          proveedores > 0 ? Math.round(ventaNetaTotal / proveedores) : null,
        top1SharePct:
          ventaNetaTotal > 0 ? Math.round((top1 / ventaNetaTotal) * 1000) / 10 : null,
        top10SharePct:
          ventaNetaTotal > 0
            ? Math.round((top10 / ventaNetaTotal) * 1000) / 10
            : null,
      },
      rows,
      bySede: bySedeRaw.map((row) => ({
        sede:
          resolveTiendaSede(row.empresa, row.idCo)?.name ??
          `${row.empresa}|${row.idCo}`,
        ventaNeta: row.ventaNeta,
        unidades: row.unidades,
        proveedores: row.proveedores,
      })),
      byDay: byDayRaw,
    };
  }

  const params: unknown[] = [window.fechaInicio, window.fechaFin];
  const clauses = [
    `fecha_dcto >= $1`,
    `fecha_dcto <= $2`,
    `fecha_dcto ~ '^[0-9]{8}$'`,
    `btrim(COALESCE(proveedor, '')) <> ''`,
  ];

  if (args.sede) {
    const aliases = sedeFilterAliases(args.sede);
    const start = params.length + 1;
    aliases.forEach((alias) => params.push(alias));
    const ors = aliases
      .map((_, i) => `lower(btrim(COALESCE(sede, ''))) LIKE lower($${start + i})`)
      .join(" OR ");
    clauses.push(`(${ors})`);
  }

  const q = (args.q ?? "").trim().slice(0, 80);
  if (q) {
    params.push(`%${q.replace(/[%_]/g, "")}%`);
    const idx = params.length;
    clauses.push(
      `(proveedor ILIKE $${idx} OR COALESCE(id_cricla1, '') ILIKE $${idx})`,
    );
  }

  const whereSql = clauses.join(" AND ");
  const limit = Math.min(Math.max(args.limit ?? 500, 1), 2000);

  const rowsResult = await client.query(
    `
    SELECT
      proveedor,
      max(NULLIF(btrim(id_cricla1), '')) AS codigo,
      COALESCE(sum(unidades), 0)::numeric AS unidades,
      COALESCE(sum(venta_base), 0)::numeric AS venta_neta,
      COALESCE(sum(venta_con_impuesto), 0)::numeric AS venta_con_impuesto,
      COALESCE(sum(items), 0)::numeric AS items,
      count(DISTINCT NULLIF(btrim(sede), ''))::int AS sedes_activas
    FROM ventas_proveedor_dia
    WHERE ${whereSql}
    GROUP BY proveedor
    ORDER BY venta_neta DESC NULLS LAST, proveedor ASC
    LIMIT $${params.length + 1}
    `,
    [...params, limit],
  );

  const rows: ProveedorVentasRow[] = (rowsResult.rows ?? []).map((row) => ({
    proveedor: String(row.proveedor ?? ""),
    codigo: row.codigo == null ? null : String(row.codigo),
    unidades: moneyNum(row.unidades),
    ventaNeta: moneyNum(row.venta_neta),
    ventaConImpuesto: moneyNum(row.venta_con_impuesto),
    items: moneyNum(row.items),
    sedesActivas: Number(row.sedes_activas ?? 0),
  }));

  const totalsResult = await client.query(
    `
    SELECT
      count(DISTINCT proveedor)::int AS proveedores,
      COALESCE(sum(unidades), 0)::numeric AS unidades,
      COALESCE(sum(venta_base), 0)::numeric AS venta_neta,
      COALESCE(sum(venta_con_impuesto), 0)::numeric AS venta_con_impuesto
    FROM ventas_proveedor_dia
    WHERE ${whereSql}
    `,
    params,
  );
  const t = totalsResult.rows[0] ?? {};
  const ventaNetaTotal = moneyNum(t.venta_neta);
  const proveedores = Number(t.proveedores ?? 0);

  const topShareResult = await client.query(
    `
    WITH ranked AS (
      SELECT
        proveedor,
        COALESCE(sum(venta_base), 0)::numeric AS venta_neta
      FROM ventas_proveedor_dia
      WHERE ${whereSql}
      GROUP BY proveedor
    ),
    ordered AS (
      SELECT
        venta_neta,
        row_number() OVER (ORDER BY venta_neta DESC NULLS LAST) AS rn
      FROM ranked
    )
    SELECT
      COALESCE(sum(venta_neta) FILTER (WHERE rn = 1), 0)::numeric AS top1,
      COALESCE(sum(venta_neta) FILTER (WHERE rn <= 10), 0)::numeric AS top10
    FROM ordered
    `,
    params,
  );
  const top1 = moneyNum(topShareResult.rows[0]?.top1);
  const top10 = moneyNum(topShareResult.rows[0]?.top10);

  const bySedeResult = await client.query(
    `
    SELECT
      COALESCE(NULLIF(btrim(sede), ''), 'Sin sede') AS sede,
      COALESCE(sum(venta_base), 0)::numeric AS venta_neta,
      COALESCE(sum(unidades), 0)::numeric AS unidades,
      count(DISTINCT proveedor)::int AS proveedores
    FROM ventas_proveedor_dia
    WHERE ${whereSql}
    GROUP BY 1
    ORDER BY venta_neta DESC NULLS LAST
    LIMIT 15
    `,
    params,
  );

  const byDayResult = await client.query(
    `
    SELECT
      fecha_dcto AS fecha,
      COALESCE(sum(venta_base), 0)::numeric AS venta_neta,
      COALESCE(sum(unidades), 0)::numeric AS unidades,
      count(DISTINCT proveedor)::int AS proveedores
    FROM ventas_proveedor_dia
    WHERE ${whereSql}
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    params,
  );

  return {
    metrics: {
      fechaInicio: compactToIso(window.fechaInicio),
      fechaFin: compactToIso(window.fechaFin),
      dias: window.dias,
      proveedores,
      unidadesTotal: moneyNum(t.unidades),
      ventaNetaTotal,
      ventaConImpuestoTotal: moneyNum(t.venta_con_impuesto),
      ticketPromedioNeta:
        proveedores > 0 ? Math.round(ventaNetaTotal / proveedores) : null,
      top1SharePct:
        ventaNetaTotal > 0 ? Math.round((top1 / ventaNetaTotal) * 1000) / 10 : null,
      top10SharePct:
        ventaNetaTotal > 0
          ? Math.round((top10 / ventaNetaTotal) * 1000) / 10
          : null,
    },
    rows,
    bySede: (bySedeResult.rows ?? []).map((row) => ({
      sede: String(row.sede ?? ""),
      ventaNeta: moneyNum(row.venta_neta),
      unidades: moneyNum(row.unidades),
      proveedores: Number(row.proveedores ?? 0),
    })),
    byDay: (byDayResult.rows ?? []).map((row) => ({
      fecha: compactToIso(String(row.fecha ?? "")),
      ventaNeta: moneyNum(row.venta_neta),
      unidades: moneyNum(row.unidades),
      proveedores: Number(row.proveedores ?? 0),
    })),
  };
};

export const isProveedoresVentasSede = (sede: string) =>
  (PROVEEDORES_QR_SEDES as readonly string[]).includes(sede);
