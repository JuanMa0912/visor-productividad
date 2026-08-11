import type { PoolClient } from "pg";
import { findTiendaSedeByName } from "@/lib/proveedores/line-family";
import { listQrVisitasTablePairs } from "@/lib/proveedores/qr-tables";
import {
  isProveedoresQrSede,
  PROVEEDORES_QR_SEDES,
} from "@/lib/proveedores/types";

export type OipvWeekdayKey = "L" | "Ma" | "Mi" | "J" | "V" | "S" | "D";

export const OIPV_WEEKDAY_KEYS: OipvWeekdayKey[] = [
  "L",
  "Ma",
  "Mi",
  "J",
  "V",
  "S",
  "D",
];

export type OipvWeekdayFlags = Record<OipvWeekdayKey, boolean>;

export type ProveedorOipvRow = {
  /** Clave estable: `c:CODIGO` o `n:NOMBRE`. */
  key: string;
  codigo: string | null;
  empresa: string | null;
  rsProveedor: string;
  visitante: string | null;
  asistencia: boolean;
  weekdays: OipvWeekdayFlags;
  visitas: number;
  unidades: number;
  ventaNeta: number;
  /** COGS total del periodo (margen_item_dia_roll vía proveedor_item). */
  costoMercancia: number;
};

export type ProveedorOipvBoard = {
  fechaInicio: string;
  fechaFin: string;
  sede: string | null;
  rows: ProveedorOipvRow[];
  metrics: {
    proveedores: number;
    conAsistencia: number;
    sinAsistencia: number;
    conVenta: number;
    unidadesTotal: number;
    ventaNetaTotal: number;
    costoMercanciaTotal: number;
  };
};

const emptyWeekdays = (): OipvWeekdayFlags => ({
  L: false,
  Ma: false,
  Mi: false,
  J: false,
  V: false,
  S: false,
  D: false,
});

/** ISODOW 1=lun … 7=dom → clave de columna. */
export const isoDowToWeekdayKey = (isoDow: number): OipvWeekdayKey | null => {
  switch (isoDow) {
    case 1:
      return "L";
    case 2:
      return "Ma";
    case 3:
      return "Mi";
    case 4:
      return "J";
    case 5:
      return "V";
    case 6:
      return "S";
    case 7:
      return "D";
    default:
      return null;
  }
};

export const oipvRowKey = (args: {
  codigo?: string | null;
  nombre?: string | null;
}): string => {
  const codigo = String(args.codigo ?? "")
    .trim()
    .toUpperCase();
  if (codigo && codigo !== "@SP") return `c:${codigo}`;
  const nombre = String(args.nombre ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `n:${nombre || "—"}`;
};

const toNum = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const isoToCompact = (iso: string) => iso.replace(/-/g, "");

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

const visitasUnionSql = (sedeName?: string | null): string => {
  const pairs = sedeName?.trim()
    ? listQrVisitasTablePairs().filter((p) => p.sedeName === sedeName.trim())
    : listQrVisitasTablePairs();
  if (pairs.length === 0) {
    return `(SELECT NULL::bigint AS id, NULL::text AS sede_name, NULL::text AS proveedor_codigo,
                    NULL::text AS proveedor_empresa, NULL::text AS proveedor_nombre,
                    NULL::text AS visitante_nombre, NULL::timestamptz AS entrada_at
             WHERE false) AS visitas_all`;
  }
  const parts = pairs.map(
    ({ table }) => `
      SELECT id, sede_name, proveedor_codigo, proveedor_empresa, proveedor_nombre,
             visitante_nombre, entrada_at
      FROM ${table}
    `,
  );
  return `(\n${parts.join("\nUNION ALL\n")}\n) AS visitas_all`;
};

type Acc = {
  key: string;
  codigo: string | null;
  empresa: string | null;
  rsProveedor: string;
  visitante: string | null;
  visitanteAt: number;
  weekdays: OipvWeekdayFlags;
  visitas: number;
  unidades: number;
  ventaNeta: number;
  costoMercancia: number;
};

const ensureAcc = (
  map: Map<string, Acc>,
  key: string,
  seed: Partial<Acc> & { rsProveedor?: string },
): Acc => {
  const existing = map.get(key);
  if (existing) return existing;
  const next: Acc = {
    key,
    codigo: seed.codigo ?? null,
    empresa: seed.empresa ?? null,
    rsProveedor: seed.rsProveedor ?? "—",
    visitante: seed.visitante ?? null,
    visitanteAt: seed.visitanteAt ?? 0,
    weekdays: emptyWeekdays(),
    visitas: 0,
    unidades: 0,
    ventaNeta: 0,
    costoMercancia: 0,
  };
  map.set(key, next);
  return next;
};

/**
 * Semana calendario lun–dom (America/Bogota aproximada vía offset fijo -5
 * solo para default de UI; el SQL de visitas usa timezone explícito).
 */
export const defaultOipvWeekRange = (now = new Date()): {
  dateStart: string;
  dateEnd: string;
} => {
  const bogotaMs = now.getTime() - 5 * 60 * 60 * 1000;
  const d = new Date(bogotaMs);
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1; // 1=lun … 7=dom
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (isoDow - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const fmt = (x: Date) => {
    const y = x.getUTCFullYear();
    const m = String(x.getUTCMonth() + 1).padStart(2, "0");
    const day = String(x.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  return { dateStart: fmt(monday), dateEnd: fmt(sunday) };
};

export const listOipvAsistenciaBoard = async (
  client: PoolClient,
  args: {
    dateStart: string;
    dateEnd: string;
    sede?: string | null;
    q?: string | null;
    limit?: number;
  },
): Promise<ProveedorOipvBoard> => {
  const dateStart = args.dateStart;
  const dateEnd = args.dateEnd;
  const sede = args.sede?.trim() || null;
  if (sede && !isProveedoresQrSede(sede)) {
    throw new Error("Sede no válida.");
  }

  const fromSql = visitasUnionSql(sede);
  const visitParams: unknown[] = [
    `${dateStart}T00:00:00-05:00`,
    `${dateEnd}T23:59:59.999-05:00`,
  ];
  const visitClauses = [
    `entrada_at >= $1::timestamptz`,
    `entrada_at <= $2::timestamptz`,
  ];
  const q = (args.q ?? "").trim().slice(0, 80);
  if (q) {
    visitParams.push(`%${q.replace(/[%_]/g, "")}%`);
    const idx = visitParams.length;
    visitClauses.push(
      `(proveedor_nombre ILIKE $${idx} OR visitante_nombre ILIKE $${idx} OR COALESCE(proveedor_codigo, '') ILIKE $${idx})`,
    );
  }

  const visitsResult = await client.query<{
    proveedor_codigo: string | null;
    proveedor_empresa: string | null;
    proveedor_nombre: string | null;
    visitante_nombre: string | null;
    entrada_at: Date | string;
    iso_dow: number;
  }>(
    `
    SELECT
      proveedor_codigo,
      proveedor_empresa,
      proveedor_nombre,
      visitante_nombre,
      entrada_at,
      EXTRACT(ISODOW FROM timezone('America/Bogota', entrada_at))::int AS iso_dow
    FROM ${fromSql}
    WHERE ${visitClauses.join(" AND ")}
    `,
    visitParams,
  );

  const map = new Map<string, Acc>();

  for (const row of visitsResult.rows ?? []) {
    const codigo = row.proveedor_codigo?.trim() || null;
    const nombre = String(row.proveedor_nombre ?? "").trim();
    const key = oipvRowKey({ codigo, nombre });
    const acc = ensureAcc(map, key, {
      codigo,
      empresa: row.proveedor_empresa?.trim() || null,
      rsProveedor: nombre || "—",
    });
    acc.visitas += 1;
    if (codigo && !acc.codigo) acc.codigo = codigo;
    if (row.proveedor_empresa?.trim() && !acc.empresa) {
      acc.empresa = row.proveedor_empresa.trim();
    }
    if (nombre && (acc.rsProveedor === "—" || acc.rsProveedor.length < nombre.length)) {
      acc.rsProveedor = nombre;
    }
    const entradaMs = new Date(row.entrada_at).getTime();
    if (
      Number.isFinite(entradaMs) &&
      entradaMs >= acc.visitanteAt &&
      row.visitante_nombre?.trim()
    ) {
      acc.visitanteAt = entradaMs;
      acc.visitante = row.visitante_nombre.trim();
    }
    const wd = isoDowToWeekdayKey(Number(row.iso_dow));
    if (wd) acc.weekdays[wd] = true;
  }

  const ventasParams: unknown[] = [isoToCompact(dateStart), isoToCompact(dateEnd)];
  const ventasClauses = [
    `fecha_dcto >= $1`,
    `fecha_dcto <= $2`,
    `fecha_dcto ~ '^[0-9]{8}$'`,
    `btrim(COALESCE(id_cricla1, '')) <> ''`,
    `btrim(COALESCE(id_cricla1, '')) <> '@SP'`,
  ];
  if (sede) {
    const aliases = sedeFilterAliases(sede);
    const start = ventasParams.length + 1;
    aliases.forEach((alias) => ventasParams.push(alias));
    const ors = aliases
      .map((_, i) => `lower(btrim(COALESCE(sede, ''))) LIKE lower($${start + i})`)
      .join(" OR ");
    ventasClauses.push(`(${ors})`);
  }
  if (q) {
    ventasParams.push(`%${q.replace(/[%_]/g, "")}%`);
    const idx = ventasParams.length;
    ventasClauses.push(
      `(proveedor ILIKE $${idx} OR COALESCE(id_cricla1, '') ILIKE $${idx})`,
    );
  }

  const ventasResult = await client.query<{
    codigo: string;
    empresa: string | null;
    proveedor: string;
    unidades: string | number;
    venta_neta: string | number;
  }>(
    `
    SELECT
      upper(btrim(id_cricla1)) AS codigo,
      max(NULLIF(btrim(empresa), '')) AS empresa,
      max(NULLIF(btrim(proveedor), '')) AS proveedor,
      COALESCE(sum(unidades), 0)::float8 AS unidades,
      COALESCE(sum(venta_base), 0)::float8 AS venta_neta
    FROM ventas_proveedor_dia
    WHERE ${ventasClauses.join(" AND ")}
    GROUP BY upper(btrim(id_cricla1))
    `,
    ventasParams,
  );

  for (const row of ventasResult.rows ?? []) {
    const codigo = String(row.codigo ?? "").trim();
    if (!codigo) continue;
    const key = oipvRowKey({ codigo });
    const acc = ensureAcc(map, key, {
      codigo,
      empresa: row.empresa?.trim() || null,
      rsProveedor: String(row.proveedor ?? "").trim() || "—",
    });
    acc.unidades += toNum(row.unidades);
    acc.ventaNeta += toNum(row.venta_neta);
    if (!acc.codigo) acc.codigo = codigo;
    if (row.empresa?.trim() && !acc.empresa) acc.empresa = row.empresa.trim();
    const nombre = String(row.proveedor ?? "").trim();
    if (nombre && (acc.rsProveedor === "—" || acc.rsProveedor === codigo)) {
      acc.rsProveedor = nombre;
    }
  }

  // Nombres canónicos del catálogo cuando hay código.
  const codigos = [...map.values()]
    .map((r) => r.codigo)
    .filter((c): c is string => Boolean(c));
  if (codigos.length > 0) {
    const cat = await client.query<{
      id_cricla1: string;
      nombre: string;
      empresa: string | null;
    }>(
      `
      SELECT DISTINCT ON (upper(btrim(id_cricla1)))
        upper(btrim(id_cricla1)) AS id_cricla1,
        nombre,
        empresa
      FROM proveedor_pos_catalogo
      WHERE upper(btrim(id_cricla1)) = ANY($1::text[])
        AND activo IS TRUE
      ORDER BY
        upper(btrim(id_cricla1)),
        CASE lower(btrim(empresa))
          WHEN 'mercamio' THEN 0
          WHEN 'mtodo' THEN 1
          WHEN 'bogota' THEN 2
          ELSE 9
        END
      `,
      [codigos],
    );
    for (const row of cat.rows ?? []) {
      const key = oipvRowKey({ codigo: row.id_cricla1 });
      const acc = map.get(key);
      if (!acc) continue;
      const nombre = String(row.nombre ?? "").trim();
      if (nombre) acc.rsProveedor = nombre;
      if (row.empresa?.trim() && !acc.empresa) acc.empresa = row.empresa.trim();
    }
  }

  // COGS mercancía (misma familia que /exp/precios-proveedor).
  try {
    const costoParams: unknown[] = [
      isoToCompact(dateStart),
      isoToCompact(dateEnd),
    ];
    const costoClauses = [
      `r.fecha_dcto >= $1`,
      `r.fecha_dcto <= $2`,
      `r.fecha_dcto ~ '^[0-9]{8}$'`,
      `NULLIF(btrim(pi.id_cricla1), '') IS NOT NULL`,
      `btrim(pi.id_cricla1) <> '@SP'`,
    ];
    if (sede) {
      const tienda = findTiendaSedeByName(sede);
      if (tienda) {
        costoParams.push(tienda.empresa, tienda.idCo);
        costoClauses.push(
          `r.empresa_norm = $${costoParams.length - 1}`,
          `LPAD(TRIM(r.id_co_norm), 3, '0') = $${costoParams.length}`,
        );
      }
    }
    if (q) {
      costoParams.push(`%${q.replace(/[%_]/g, "")}%`);
      const idx = costoParams.length;
      costoClauses.push(
        `(pi.id_cricla1 ILIKE $${idx} OR COALESCE(pi.descripcion, '') ILIKE $${idx})`,
      );
    }

    const costoResult = await client.query<{
      codigo: string;
      costo_total: string | number;
    }>(
      `
      SELECT
        upper(btrim(pi.id_cricla1)) AS codigo,
        COALESCE(SUM(r.costo_total), 0)::float8 AS costo_total
      FROM margen_item_dia_roll r
      INNER JOIN proveedor_item pi
        ON pi.empresa = r.empresa_norm
       AND pi.id_item = r.id_item
      WHERE ${costoClauses.join(" AND ")}
      GROUP BY upper(btrim(pi.id_cricla1))
      `,
      costoParams,
    );

    for (const row of costoResult.rows ?? []) {
      const codigo = String(row.codigo ?? "").trim();
      if (!codigo) continue;
      const key = oipvRowKey({ codigo });
      const acc = ensureAcc(map, key, { codigo, rsProveedor: codigo });
      acc.costoMercancia += toNum(row.costo_total);
      if (!acc.codigo) acc.codigo = codigo;
    }
  } catch (error) {
    console.warn(
      "[oipv] costo mercancía no disponible (margen/proveedor_item):",
      error,
    );
  }

  const limit = Math.min(Math.max(args.limit ?? 2000, 1), 5000);
  const rows: ProveedorOipvRow[] = [...map.values()]
    .map((acc) => ({
      key: acc.key,
      codigo: acc.codigo,
      empresa: acc.empresa,
      rsProveedor: acc.rsProveedor,
      visitante: acc.visitante,
      asistencia: acc.visitas > 0,
      weekdays: { ...acc.weekdays },
      visitas: acc.visitas,
      unidades: acc.unidades,
      ventaNeta: acc.ventaNeta,
      costoMercancia: acc.costoMercancia,
    }))
    .sort((a, b) => {
      if (a.asistencia !== b.asistencia) return a.asistencia ? 1 : -1;
      if (b.ventaNeta !== a.ventaNeta) return b.ventaNeta - a.ventaNeta;
      return a.rsProveedor.localeCompare(b.rsProveedor, "es");
    })
    .slice(0, limit);

  const conAsistencia = rows.filter((r) => r.asistencia).length;
  const conVenta = rows.filter((r) => r.ventaNeta > 0 || r.unidades > 0).length;

  return {
    fechaInicio: dateStart,
    fechaFin: dateEnd,
    sede,
    rows,
    metrics: {
      proveedores: rows.length,
      conAsistencia,
      sinAsistencia: rows.length - conAsistencia,
      conVenta,
      unidadesTotal: rows.reduce((s, r) => s + r.unidades, 0),
      ventaNetaTotal: rows.reduce((s, r) => s + r.ventaNeta, 0),
      costoMercanciaTotal: rows.reduce((s, r) => s + r.costoMercancia, 0),
    },
  };
};

export const isProveedoresOipvSede = (sede: string) =>
  (PROVEEDORES_QR_SEDES as readonly string[]).includes(sede);
