import type { Pool, PoolClient } from "pg";
import {
  findTiendaSedeByName,
  productividadFamiliaSqlFast,
  PROVEEDORES_TIENDA_SEDES,
  resolveTiendaSedeFromAsistencia,
  type ProveedorProductividadKpi,
  type ProveedorTiendaSede,
} from "@/lib/proveedores/line-family";
import { resolveDepartamentoLineId } from "@/lib/shared/departamento-line";

export type ProveedorProductividadFamilyQty = {
  industria: number;
  fruver: number;
  carnes: number;
  cajas: number;
};

export type ProveedorProductividadFamilyHours = {
  industriaHoras: number;
  fruverHoras: number;
  carnesHoras: number;
  cajasHoras: number;
};

export type ProveedorProductividadFamilyBucket =
  ProveedorProductividadFamilyQty & ProveedorProductividadFamilyHours;

export type ProveedorProductividadMetrics = ProveedorProductividadFamilyBucket & {
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  proveedores: number;
};

export type ProveedorProductividadBySede = ProveedorProductividadFamilyBucket & {
  sede: string;
};

export type ProveedorProductividadByDay = ProveedorProductividadFamilyBucket & {
  fecha: string;
};

export type ProveedorProductividadProveedorRow = {
  proveedor: string;
  codigo: string | null;
  industria: number;
  fruver: number;
  carnes: number;
  sedesActivas: number;
};

export type ProveedorProductividadBoard = {
  metrics: ProveedorProductividadMetrics;
  bySede: ProveedorProductividadBySede[];
  byDay: ProveedorProductividadByDay[];
};

type Db = Pool | PoolClient;

const toNum = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const isoToCompact = (iso: string) => iso.replace(/-/g, "");

const compactToIso = (compact: string) => {
  if (!/^\d{8}$/.test(compact)) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
};

const emptyFamily = (): ProveedorProductividadFamilyBucket => ({
  industria: 0,
  fruver: 0,
  carnes: 0,
  cajas: 0,
  industriaHoras: 0,
  fruverHoras: 0,
  carnesHoras: 0,
  cajasHoras: 0,
});

const emptyMetrics = (
  fechaInicio: string,
  fechaFin: string,
  dias: number,
): ProveedorProductividadMetrics => ({
  fechaInicio,
  fechaFin,
  dias,
  ...emptyFamily(),
  proveedores: 0,
});

/** qty / horas pagadas; 0 si no hay horas. */
export const qtyPerPaidHour = (qty: number, hours: number): number =>
  hours > 0 ? qty / hours : 0;

const HOURS_FIELD: Record<
  ProveedorProductividadKpi,
  keyof ProveedorProductividadFamilyHours
> = {
  industria: "industriaHoras",
  fruver: "fruverHoras",
  carnes: "carnesHoras",
  cajas: "cajasHoras",
};

const lineIdToFamilia = (
  lineId: string | undefined,
): ProveedorProductividadKpi | null => {
  if (!lineId) return null;
  if (
    lineId === "industria" ||
    lineId === "fruver" ||
    lineId === "carnes" ||
    lineId === "cajas"
  ) {
    return lineId;
  }
  return null;
};

const toIsoDateFromDb = (value: unknown): string => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{8}$/.test(raw)) return compactToIso(raw);
  return raw;
};

const resolveSedes = (sedeName?: string | null): ProveedorTiendaSede[] => {
  if (sedeName?.trim()) {
    const hit = findTiendaSedeByName(sedeName.trim());
    return hit ? [hit] : [];
  }
  return [...PROVEEDORES_TIENDA_SEDES];
};

const resolveWindow = (dateStart: string, dateEnd: string) => {
  const startMs = Date.parse(`${dateStart}T12:00:00`);
  const endMs = Date.parse(`${dateEnd}T12:00:00`);
  const dias =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      ? Math.floor((endMs - startMs) / 86_400_000) + 1
      : 0;
  return {
    fechaInicio: dateStart,
    fechaFin: dateEnd,
    dias,
    fromCompact: isoToCompact(dateStart),
    toCompact: isoToCompact(dateEnd),
  };
};

/** VALUES (empresa, id_co, sede) para JOIN sin envolver columnas del hecho. */
const sedesValuesSql = (sedes: ProveedorTiendaSede[], params: unknown[]) => {
  const tuples = sedes.map((sede) => {
    params.push(sede.empresa, sede.idCo, sede.name);
    return `($${params.length - 2}, $${params.length - 1}, $${params.length})`;
  });
  return `SELECT * FROM (VALUES ${tuples.join(", ")}) AS s(empresa, id_co, sede)`;
};

const familiaExpr = productividadFamiliaSqlFast("r.id_linea1");

const addHours = (
  bucket: ProveedorProductividadFamilyBucket,
  familia: ProveedorProductividadKpi,
  hours: number,
) => {
  bucket[HOURS_FIELD[familia]] += hours;
};

/**
 * Tablero rápido: KPIs + sede + día. Sin join a proveedor_item.
 * Roll, cajas y horas pagadas en paralelo sobre el pool.
 */
export const queryProductividadBoard = async (
  db: Db,
  args: { dateStart: string; dateEnd: string; sede?: string | null },
): Promise<ProveedorProductividadBoard> => {
  const window = resolveWindow(args.dateStart, args.dateEnd);
  const sedes = resolveSedes(args.sede);
  if (sedes.length === 0 || window.dias <= 0) {
    return {
      metrics: emptyMetrics(window.fechaInicio, window.fechaFin, window.dias),
      bySede: [],
      byDay: [],
    };
  }

  const sedeNameSet = new Set(sedes.map((s) => s.name));
  const rollParams: unknown[] = [window.fromCompact, window.toCompact];
  const rollSedes = sedesValuesSql(sedes, rollParams);
  const cajasParams: unknown[] = [window.fromCompact, window.toCompact];
  const cajasSedes = sedesValuesSql(sedes, cajasParams);
  const hoursParams: unknown[] = [window.fechaInicio, window.fechaFin];

  const [rollResult, cajasResult, hoursResult] = await Promise.all([
    db.query<{
      sede: string;
      fecha: string;
      industria: string | number;
      fruver: string | number;
      carnes: string | number;
    }>(
      `
      SELECT
        s.sede,
        r.fecha_dcto AS fecha,
        COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'industria'), 0)::float8 AS industria,
        COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'fruver'), 0)::float8 AS fruver,
        COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'carnes'), 0)::float8 AS carnes
      FROM margen_item_dia_roll r
      INNER JOIN (${rollSedes}) s
        ON s.empresa = LOWER(TRIM(r.empresa_norm))
       AND s.id_co = LPAD(TRIM(r.id_co_norm), 3, '0')
      CROSS JOIN LATERAL (SELECT ${familiaExpr} AS familia) fam
      WHERE r.fecha_dcto >= $1
        AND r.fecha_dcto <= $2
        AND COALESCE(r.id_tipo, '') IS DISTINCT FROM '3'
        AND fam.familia IS NOT NULL
      GROUP BY s.sede, r.fecha_dcto
      `,
      rollParams,
    ),
    db.query<{
      sede: string;
      fecha: string;
      tx: string | number;
    }>(
      `
      SELECT
        s.sede,
        v.fecha_dcto AS fecha,
        COUNT(*)::int AS tx
      FROM ventas_cajas v
      INNER JOIN (${cajasSedes}) s
        ON s.empresa = LOWER(TRIM(COALESCE(v.empresa_bd, '')))
       AND s.id_co = LPAD(TRIM(COALESCE(v.centro_operacion::text, '')), 3, '0')
      WHERE v.fecha_dcto >= $1
        AND v.fecha_dcto <= $2
        AND COALESCE(v.total_bruto, 0) > 0
      GROUP BY s.sede, v.fecha_dcto
      `,
      cajasParams,
    ),
    db.query<{
      fecha: Date | string;
      sede: string;
      departamento: string;
      horas: string | number;
    }>(
      `
      SELECT
        a.fecha::text AS fecha,
        a.sede,
        a.departamento,
        COALESCE(SUM(a.total_laborado_horas), 0)::float8 AS horas
      FROM asistencia_horas a
      WHERE a.fecha >= $1::date
        AND a.fecha <= $2::date
        AND a.sede IS NOT NULL
        AND a.departamento IS NOT NULL
      GROUP BY a.fecha, a.sede, a.departamento
      `,
      hoursParams,
    ).catch((error) => {
      console.warn(
        "[proveedores/productividad] asistencia_horas no disponible:",
        error,
      );
      return { rows: [] as Array<{
        fecha: Date | string;
        sede: string;
        departamento: string;
        horas: string | number;
      }> };
    }),
  ]);

  const bySedeMap = new Map<string, ProveedorProductividadFamilyBucket>();
  for (const sede of sedes) bySedeMap.set(sede.name, emptyFamily());
  const byDayMap = new Map<string, ProveedorProductividadFamilyBucket>();
  const totals = emptyFamily();

  for (const row of rollResult.rows) {
    const industria = toNum(row.industria);
    const fruver = toNum(row.fruver);
    const carnes = toNum(row.carnes);
    totals.industria += industria;
    totals.fruver += fruver;
    totals.carnes += carnes;
    const sedeBucket = bySedeMap.get(row.sede) ?? emptyFamily();
    sedeBucket.industria += industria;
    sedeBucket.fruver += fruver;
    sedeBucket.carnes += carnes;
    bySedeMap.set(row.sede, sedeBucket);
    const fecha = compactToIso(String(row.fecha ?? ""));
    const dayBucket = byDayMap.get(fecha) ?? emptyFamily();
    dayBucket.industria += industria;
    dayBucket.fruver += fruver;
    dayBucket.carnes += carnes;
    byDayMap.set(fecha, dayBucket);
  }

  for (const row of cajasResult.rows) {
    const tx = toNum(row.tx);
    totals.cajas += tx;
    const sedeBucket = bySedeMap.get(row.sede) ?? emptyFamily();
    sedeBucket.cajas += tx;
    bySedeMap.set(row.sede, sedeBucket);
    const fecha = compactToIso(String(row.fecha ?? ""));
    const dayBucket = byDayMap.get(fecha) ?? emptyFamily();
    dayBucket.cajas += tx;
    byDayMap.set(fecha, dayBucket);
  }

  for (const row of hoursResult.rows) {
    const familia = lineIdToFamilia(
      resolveDepartamentoLineId(String(row.departamento ?? "")),
    );
    if (!familia) continue;
    const tienda = resolveTiendaSedeFromAsistencia(String(row.sede ?? ""));
    if (!tienda || !sedeNameSet.has(tienda.name)) continue;
    const hours = toNum(row.horas);
    if (hours <= 0) continue;
    addHours(totals, familia, hours);
    const sedeBucket = bySedeMap.get(tienda.name) ?? emptyFamily();
    addHours(sedeBucket, familia, hours);
    bySedeMap.set(tienda.name, sedeBucket);
    const fecha = toIsoDateFromDb(row.fecha);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
    const dayBucket = byDayMap.get(fecha) ?? emptyFamily();
    addHours(dayBucket, familia, hours);
    byDayMap.set(fecha, dayBucket);
  }

  return {
    metrics: {
      fechaInicio: window.fechaInicio,
      fechaFin: window.fechaFin,
      dias: window.dias,
      ...totals,
      proveedores: 0,
    },
    bySede: sedes.map((sede) => ({
      sede: sede.name,
      ...(bySedeMap.get(sede.name) ?? emptyFamily()),
    })),
    byDay: [...byDayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fecha, bucket]) => ({ fecha, ...bucket })),
  };
};

/**
 * Ranking por proveedor (más pesado). Se pide aparte del tablero.
 */
export const queryProductividadProveedores = async (
  db: Db,
  args: {
    dateStart: string;
    dateEnd: string;
    sede?: string | null;
    q?: string | null;
    limit?: number;
  },
): Promise<ProveedorProductividadProveedorRow[]> => {
  const window = resolveWindow(args.dateStart, args.dateEnd);
  const sedes = resolveSedes(args.sede);
  if (sedes.length === 0 || window.dias <= 0) return [];

  const params: unknown[] = [window.fromCompact, window.toCompact];
  const sedesSql = sedesValuesSql(sedes, params);
  const q = (args.q ?? "").trim().slice(0, 80);
  let searchSql = "";
  if (q) {
    params.push(`%${q.replace(/[%_]/g, "")}%`);
    searchSql = `
      AND (
        COALESCE(NULLIF(TRIM(pc.nombre), ''), NULLIF(TRIM(pi.descripcion), ''), '') ILIKE $${params.length}
        OR COALESCE(pi.id_cricla1, '') ILIKE $${params.length}
      )
    `;
  }
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 2000);
  params.push(limit);

  const result = await db.query<{
    proveedor: string;
    codigo: string | null;
    industria: string | number;
    fruver: string | number;
    carnes: string | number;
    sedes_activas: string | number;
  }>(
    `
    SELECT
      COALESCE(NULLIF(TRIM(pc.nombre), ''), NULLIF(TRIM(pi.descripcion), ''), '(Sin proveedor)') AS proveedor,
      MAX(NULLIF(TRIM(pi.id_cricla1), '')) AS codigo,
      COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'industria'), 0)::float8 AS industria,
      COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'fruver'), 0)::float8 AS fruver,
      COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'carnes'), 0)::float8 AS carnes,
      COUNT(DISTINCT r.id_co_norm)::int AS sedes_activas
    FROM margen_item_dia_roll r
    INNER JOIN (${sedesSql}) s
      ON s.empresa = LOWER(TRIM(r.empresa_norm))
     AND s.id_co = LPAD(TRIM(r.id_co_norm), 3, '0')
    INNER JOIN proveedor_item pi
      ON pi.empresa = r.empresa_norm
     AND pi.id_item = r.id_item
    LEFT JOIN proveedor_pos_catalogo pc
      ON pc.empresa = pi.empresa
     AND pc.id_cricla1 = pi.id_cricla1
    CROSS JOIN LATERAL (SELECT ${familiaExpr} AS familia) fam
    WHERE r.fecha_dcto >= $1
      AND r.fecha_dcto <= $2
      AND COALESCE(r.id_tipo, '') IS DISTINCT FROM '3'
      AND fam.familia IS NOT NULL
      ${searchSql}
    GROUP BY 1
    HAVING (
      COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'industria'), 0)
      + COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'fruver'), 0)
      + COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'carnes'), 0)
    ) <> 0
    ORDER BY (
      COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'industria'), 0)
      + COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'fruver'), 0)
      + COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'carnes'), 0)
    ) DESC NULLS LAST, 1 ASC
    LIMIT $${params.length}
    `,
    params,
  );

  return result.rows.map((row) => ({
    proveedor: String(row.proveedor ?? "(Sin proveedor)"),
    codigo: row.codigo == null ? null : String(row.codigo),
    industria: toNum(row.industria),
    fruver: toNum(row.fruver),
    carnes: toNum(row.carnes),
    sedesActivas: Number(row.sedes_activas ?? 0),
  }));
};

/** Compat: board + proveedores en una sola llamada (export / legacy). */
export const listProductividadProveedores = async (
  db: Db,
  args: {
    dateStart: string;
    dateEnd: string;
    sede?: string | null;
    q?: string | null;
    proveedorLimit?: number;
  },
) => {
  const [board, proveedores] = await Promise.all([
    queryProductividadBoard(db, args),
    queryProductividadProveedores(db, {
      ...args,
      limit: args.proveedorLimit ?? 100,
    }),
  ]);
  return {
    ...board,
    metrics: {
      ...board.metrics,
      proveedores: proveedores.length,
    },
    proveedores,
  };
};
