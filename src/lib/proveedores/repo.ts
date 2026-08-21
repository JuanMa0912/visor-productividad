import type { PoolClient } from "pg";
import { proveedoresVisitasEntradaRangeSql } from "@/lib/proveedores/board-filters";
import { normalizeEmpresaBd } from "@/lib/proveedores/line-family";
import {
  listQrVisitasTablePairs,
  resolveQrVisitasTable,
} from "@/lib/proveedores/qr-tables";
import {
  decodeProveedorPosKey,
  encodeProveedorPosKey,
  isValidProveedorToken,
  normalizeProveedorToken,
  type ProveedorCatalogItem,
  type ProveedorVisitaOpen,
  type ProveedorVisitaRow,
  type ProveedorVisitasMetrics,
} from "@/lib/proveedores/types";

export type ProveedorSedeQr = {
  sedeName: string;
  token: string;
  activo: boolean;
};

type VisitasFilterArgs = {
  dateStart: string;
  dateEnd: string;
  sedeName?: string | null;
  q?: string | null;
};

const requireQrTable = (sedeName: string): string => {
  const table = resolveQrVisitasTable(sedeName);
  if (!table) {
    throw new Error(`Sede QR no válida: ${sedeName}`);
  }
  return table;
};

/** FROM clause: una tabla o UNION ALL de las 11 (solo whitelist). */
const visitasFromSql = (sedeName?: string | null): string => {
  if (sedeName?.trim()) {
    return requireQrTable(sedeName.trim());
  }
  const parts = listQrVisitasTablePairs().map(
    ({ table }) =>
      `SELECT id, sede_name, proveedor_codigo, proveedor_empresa, proveedor_nombre,
              visitante_nombre, visitante_cedula, entrada_at, salida_at
       FROM ${table}`,
  );
  return `(\n${parts.join("\nUNION ALL\n")}\n) AS visitas_all`;
};

const buildVisitasFilter = (args: VisitasFilterArgs) => {
  const params: unknown[] = [args.dateStart, args.dateEnd];
  const clauses = [proveedoresVisitasEntradaRangeSql(1, 2)];
  // Filtro por sede: la tabla física ya lo implica; no hace falta sede_name = $n.
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

export const resolveSedeByToken = async (
  client: PoolClient,
  tokenRaw: unknown,
): Promise<ProveedorSedeQr | null> => {
  const token = normalizeProveedorToken(tokenRaw);
  if (!isValidProveedorToken(token)) return null;
  const result = await client.query(
    `
    SELECT sede_name, token, activo
    FROM proveedor_sede_qr
    WHERE token = $1
    LIMIT 1
    `,
    [token],
  );
  const row = result.rows?.[0] as
    | { sede_name?: string; token?: string; activo?: boolean }
    | undefined;
  if (!row?.sede_name || !row.token || row.activo === false) return null;
  return {
    sedeName: String(row.sede_name),
    token: String(row.token),
    activo: true,
  };
};

const mapCatalogRow = (row: {
  empresa: string;
  codigo: string;
  sucursal: string;
  nombre: string;
  nit: string | null;
}): ProveedorCatalogItem => ({
  id: encodeProveedorPosKey(row.empresa, row.codigo, row.sucursal),
  empresa: String(row.empresa),
  codigo: String(row.codigo),
  sucursal: String(row.sucursal || "00"),
  nombre: String(row.nombre),
  nit: row.nit == null || String(row.nit).trim() === "" ? null : String(row.nit),
});

/**
 * Maestro comercial POS (`proveedor_tercero`).
 * Con `empresa` (sede del QR) solo lista esa compañía; sin ella, las 3.
 */
export const searchProveedorCatalog = async (
  client: PoolClient,
  query: string,
  limit = 20,
  empresa?: string | null,
): Promise<ProveedorCatalogItem[]> => {
  const q = query.trim().slice(0, 80);
  const capped = Math.min(Math.max(limit, 1), 50);
  const safeLike = q.replace(/[%_]/g, "");
  const empresaNorm = empresa?.trim()
    ? normalizeEmpresaBd(empresa.trim())
    : null;

  const params: unknown[] = [];
  const where: string[] = [
    "activo IS TRUE",
    "btrim(COALESCE(nombre, '')) <> ''",
  ];
  if (empresaNorm) {
    params.push(empresaNorm);
    where.push(`lower(btrim(empresa)) = $${params.length}`);
  }
  if (safeLike) {
    params.push(`%${safeLike}%`);
    where.push(
      `(nombre ILIKE $${params.length} OR COALESCE(codigo, '') ILIKE $${params.length} OR COALESCE(nit, '') ILIKE $${params.length})`,
    );
  }
  params.push(capped);

  const result = await client.query(
    `
    SELECT empresa, codigo, sucursal, nombre, nit
    FROM proveedor_tercero
    WHERE ${where.join("\n      AND ")}
    ORDER BY
      lower(btrim(nombre)),
      CASE lower(btrim(empresa))
        WHEN 'mercamio' THEN 0
        WHEN 'mtodo' THEN 1
        WHEN 'bogota' THEN 2
        ELSE 9
      END,
      codigo,
      sucursal
    LIMIT $${params.length}
    `,
    params,
  );
  return (result.rows ?? []).map((row) =>
    mapCatalogRow(
      row as {
        empresa: string;
        codigo: string;
        sucursal: string;
        nombre: string;
        nit: string | null;
      },
    ),
  );
};

export const getProveedorById = async (
  client: PoolClient,
  id: unknown,
  empresa?: string | null,
): Promise<ProveedorCatalogItem | null> => {
  const key = decodeProveedorPosKey(id);
  if (!key) return null;
  const empresaNorm = empresa?.trim()
    ? normalizeEmpresaBd(empresa.trim())
    : null;
  if (empresaNorm && normalizeEmpresaBd(key.empresa) !== empresaNorm) {
    return null;
  }
  const result = await client.query(
    `
    SELECT empresa, codigo, sucursal, nombre, nit
    FROM proveedor_tercero
    WHERE empresa = $1
      AND codigo = $2
      AND sucursal = $3
      AND activo IS TRUE
    LIMIT 1
    `,
    [key.empresa, key.codigo, key.sucursal],
  );
  const row = result.rows?.[0] as
    | {
        empresa?: string;
        codigo?: string;
        sucursal?: string;
        nombre?: string;
        nit?: string | null;
      }
    | undefined;
  if (!row?.empresa || !row.codigo || !row.nombre) return null;
  return mapCatalogRow({
    empresa: row.empresa,
    codigo: row.codigo,
    sucursal: row.sucursal ?? "00",
    nombre: row.nombre,
    nit: row.nit ?? null,
  });
};

export const findOpenVisit = async (
  client: PoolClient,
  args: { sedeName: string; cedula: string },
): Promise<ProveedorVisitaOpen | null> => {
  const table = requireQrTable(args.sedeName);
  const result = await client.query(
    `
    SELECT id, sede_name, proveedor_nombre, visitante_nombre, visitante_cedula, entrada_at
    FROM ${table}
    WHERE visitante_cedula = $1
      AND salida_at IS NULL
    ORDER BY entrada_at DESC
    LIMIT 1
    `,
    [args.cedula],
  );
  const row = result.rows?.[0] as
    | {
        id: number;
        sede_name: string;
        proveedor_nombre: string;
        visitante_nombre: string;
        visitante_cedula: string;
        entrada_at: Date | string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    sedeName: String(row.sede_name),
    proveedorNombre: String(row.proveedor_nombre),
    visitanteNombre: String(row.visitante_nombre),
    visitanteCedula: String(row.visitante_cedula),
    entradaAt: new Date(row.entrada_at).toISOString(),
  };
};

export const insertEntrada = async (
  client: PoolClient,
  args: {
    sedeName: string;
    proveedorCodigo: string;
    proveedorEmpresa: string;
    proveedorNombre: string;
    visitanteNombre: string;
    visitanteCedula: string;
    clientIp: string | null;
    userAgent: string | null;
    autorizacionDatosAt: Date;
  },
): Promise<ProveedorVisitaOpen> => {
  const table = requireQrTable(args.sedeName);
  const result = await client.query(
    `
    INSERT INTO ${table} (
      sede_name, proveedor_codigo, proveedor_empresa, proveedor_nombre,
      visitante_nombre, visitante_cedula, client_ip, user_agent,
      autorizacion_datos_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, sede_name, proveedor_nombre, visitante_nombre, visitante_cedula, entrada_at
    `,
    [
      args.sedeName,
      args.proveedorCodigo,
      args.proveedorEmpresa,
      args.proveedorNombre,
      args.visitanteNombre,
      args.visitanteCedula,
      args.clientIp,
      args.userAgent,
      args.autorizacionDatosAt.toISOString(),
    ],
  );
  const row = result.rows[0] as {
    id: number;
    sede_name: string;
    proveedor_nombre: string;
    visitante_nombre: string;
    visitante_cedula: string;
    entrada_at: Date | string;
  };
  return {
    id: Number(row.id),
    sedeName: String(row.sede_name),
    proveedorNombre: String(row.proveedor_nombre),
    visitanteNombre: String(row.visitante_nombre),
    visitanteCedula: String(row.visitante_cedula),
    entradaAt: new Date(row.entrada_at).toISOString(),
  };
};

export const closeSalida = async (
  client: PoolClient,
  args: { visitId: number; sedeName: string; cedula: string },
): Promise<ProveedorVisitaOpen | null> => {
  const table = requireQrTable(args.sedeName);
  const result = await client.query(
    `
    UPDATE ${table}
    SET salida_at = now()
    WHERE id = $1
      AND visitante_cedula = $2
      AND salida_at IS NULL
    RETURNING id, sede_name, proveedor_nombre, visitante_nombre, visitante_cedula, entrada_at, salida_at
    `,
    [args.visitId, args.cedula],
  );
  const row = result.rows?.[0] as
    | {
        id: number;
        sede_name: string;
        proveedor_nombre: string;
        visitante_nombre: string;
        visitante_cedula: string;
        entrada_at: Date | string;
        salida_at: Date | string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    sedeName: String(row.sede_name),
    proveedorNombre: String(row.proveedor_nombre),
    visitanteNombre: String(row.visitante_nombre),
    visitanteCedula: String(row.visitante_cedula),
    entradaAt: new Date(row.entrada_at).toISOString(),
  };
};

const mapVisitaRow = (row: Record<string, unknown>): ProveedorVisitaRow => {
  const entradaAt = new Date(String(row.entrada_at));
  const salidaRaw = row.salida_at;
  const salidaAt = salidaRaw ? new Date(String(salidaRaw)) : null;
  let duracionMinutos: number | null = null;
  if (salidaAt && Number.isFinite(entradaAt.getTime()) && Number.isFinite(salidaAt.getTime())) {
    duracionMinutos = Math.max(
      0,
      Math.round((salidaAt.getTime() - entradaAt.getTime()) / 60_000),
    );
  }
  const codigo = row.proveedor_codigo == null ? null : String(row.proveedor_codigo);
  const empresa = row.proveedor_empresa == null ? null : String(row.proveedor_empresa);
  return {
    id: Number(row.id),
    sedeName: String(row.sede_name ?? ""),
    proveedorId:
      codigo && empresa ? encodeProveedorPosKey(empresa, codigo) : codigo,
    proveedorNombre: String(row.proveedor_nombre ?? ""),
    visitanteNombre: String(row.visitante_nombre ?? ""),
    visitanteCedula: String(row.visitante_cedula ?? ""),
    entradaAt: entradaAt.toISOString(),
    salidaAt: salidaAt ? salidaAt.toISOString() : null,
    duracionMinutos,
  };
};

export const listVisitas = async (
  client: PoolClient,
  args: VisitasFilterArgs & { limit?: number },
): Promise<ProveedorVisitaRow[]> => {
  const limit = Math.min(Math.max(args.limit ?? 500, 1), 2000);
  const { params, whereSql } = buildVisitasFilter(args);
  const fromSql = visitasFromSql(args.sedeName);
  const allParams = [...params, limit];
  const result = await client.query(
    `
    SELECT id, sede_name, proveedor_codigo, proveedor_empresa, proveedor_nombre,
           visitante_nombre, visitante_cedula, entrada_at, salida_at
    FROM ${fromSql}
    WHERE ${whereSql}
    ORDER BY entrada_at DESC
    LIMIT $${allParams.length}
    `,
    allParams,
  );
  return (result.rows ?? []).map((row) => mapVisitaRow(row as Record<string, unknown>));
};

const round1 = (value: number) => Math.round(value * 10) / 10;

export const computeVisitasMetrics = async (
  client: PoolClient,
  args: VisitasFilterArgs,
): Promise<ProveedorVisitasMetrics> => {
  const { params, whereSql } = buildVisitasFilter(args);
  const fromSql = visitasFromSql(args.sedeName);

  const summaryResult = await client.query(
    `
    WITH filtered AS (
      SELECT *
      FROM ${fromSql}
      WHERE ${whereSql}
    ),
    closed AS (
      SELECT EXTRACT(EPOCH FROM (salida_at - entrada_at)) / 60.0 AS mins
      FROM filtered
      WHERE salida_at IS NOT NULL
    )
    SELECT
      (SELECT count(*)::int FROM filtered) AS total,
      (SELECT count(*)::int FROM filtered WHERE salida_at IS NULL) AS abiertas,
      (SELECT count(*)::int FROM filtered WHERE salida_at IS NOT NULL) AS cerradas,
      (SELECT count(DISTINCT lower(btrim(proveedor_nombre)))::int FROM filtered) AS proveedores,
      (SELECT count(DISTINCT visitante_cedula)::int FROM filtered) AS visitantes,
      (SELECT avg(mins) FROM closed) AS avg_min,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mins) FROM closed) AS median_min
    `,
    params,
  );
  const s = summaryResult.rows[0] as {
    total?: number;
    abiertas?: number;
    cerradas?: number;
    proveedores?: number;
    visitantes?: number;
    avg_min?: string | number | null;
    median_min?: string | number | null;
  };

  const bySedeResult = await client.query(
    `
    SELECT
      sede_name,
      count(*)::int AS visitas,
      count(*) FILTER (WHERE salida_at IS NULL)::int AS abiertas,
      avg(
        EXTRACT(EPOCH FROM (salida_at - entrada_at)) / 60.0
      ) FILTER (WHERE salida_at IS NOT NULL) AS avg_min
    FROM ${fromSql}
    WHERE ${whereSql}
    GROUP BY sede_name
    ORDER BY visitas DESC, sede_name ASC
    `,
    params,
  );

  const byProveedorResult = await client.query(
    `
    SELECT
      proveedor_nombre,
      count(*)::int AS visitas,
      avg(
        EXTRACT(EPOCH FROM (salida_at - entrada_at)) / 60.0
      ) FILTER (WHERE salida_at IS NOT NULL) AS avg_min
    FROM ${fromSql}
    WHERE ${whereSql}
    GROUP BY proveedor_nombre
    ORDER BY visitas DESC, proveedor_nombre ASC
    LIMIT 12
    `,
    params,
  );

  const byDayResult = await client.query(
    `
    SELECT
      to_char(timezone('America/Bogota', entrada_at), 'YYYY-MM-DD') AS dia,
      count(*)::int AS visitas,
      count(*) FILTER (WHERE salida_at IS NULL)::int AS abiertas
    FROM ${fromSql}
    WHERE ${whereSql}
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    params,
  );

  const byHourResult = await client.query(
    `
    SELECT
      EXTRACT(HOUR FROM timezone('America/Bogota', entrada_at))::int AS hora,
      count(*)::int AS visitas
    FROM ${fromSql}
    WHERE ${whereSql}
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    params,
  );

  const avgRaw = s.avg_min == null ? null : Number(s.avg_min);
  const medianRaw = s.median_min == null ? null : Number(s.median_min);

  return {
    totalVisitas: Number(s.total ?? 0),
    abiertas: Number(s.abiertas ?? 0),
    cerradas: Number(s.cerradas ?? 0),
    proveedoresUnicos: Number(s.proveedores ?? 0),
    visitantesUnicos: Number(s.visitantes ?? 0),
    duracionPromedioMin:
      avgRaw != null && Number.isFinite(avgRaw) ? round1(avgRaw) : null,
    duracionMedianaMin:
      medianRaw != null && Number.isFinite(medianRaw) ? round1(medianRaw) : null,
    bySede: (bySedeResult.rows ?? []).map((row) => {
      const avg = row.avg_min == null ? null : Number(row.avg_min);
      return {
        sedeName: String(row.sede_name ?? ""),
        visitas: Number(row.visitas ?? 0),
        abiertas: Number(row.abiertas ?? 0),
        duracionPromedioMin:
          avg != null && Number.isFinite(avg) ? round1(avg) : null,
      };
    }),
    byProveedor: (byProveedorResult.rows ?? []).map((row) => {
      const avg = row.avg_min == null ? null : Number(row.avg_min);
      return {
        proveedorNombre: String(row.proveedor_nombre ?? ""),
        visitas: Number(row.visitas ?? 0),
        duracionPromedioMin:
          avg != null && Number.isFinite(avg) ? round1(avg) : null,
      };
    }),
    byDay: (byDayResult.rows ?? []).map((row) => ({
      date: String(row.dia ?? ""),
      visitas: Number(row.visitas ?? 0),
      abiertas: Number(row.abiertas ?? 0),
    })),
    byHour: (byHourResult.rows ?? []).map((row) => ({
      hour: Number(row.hora ?? 0),
      visitas: Number(row.visitas ?? 0),
    })),
  };
};

export const listSedeQrTokens = async (
  client: PoolClient,
): Promise<ProveedorSedeQr[]> => {
  const result = await client.query(
    `
    SELECT sede_name, token, activo
    FROM proveedor_sede_qr
    ORDER BY sede_name ASC
    `,
  );
  return (result.rows ?? []).map((row) => ({
    sedeName: String((row as { sede_name: string }).sede_name),
    token: String((row as { token: string }).token),
    activo: Boolean((row as { activo: boolean }).activo),
  }));
};

export const countActiveProveedorCatalog = async (
  client: PoolClient,
  empresa?: string | null,
): Promise<number> => {
  const empresaNorm = empresa?.trim()
    ? normalizeEmpresaBd(empresa.trim())
    : null;
  if (!empresaNorm) {
    const result = await client.query(
      `
      SELECT count(*)::int AS n
      FROM proveedor_tercero
      WHERE activo IS TRUE
        AND btrim(COALESCE(nombre, '')) <> ''
      `,
    );
    return Number(result.rows?.[0]?.n ?? 0);
  }
  const result = await client.query(
    `
    SELECT count(*)::int AS n
    FROM proveedor_tercero
    WHERE activo IS TRUE
      AND btrim(COALESCE(nombre, '')) <> ''
      AND lower(btrim(empresa)) = $1
    `,
    [empresaNorm],
  );
  return Number(result.rows?.[0]?.n ?? 0);
};
