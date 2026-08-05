import type { PoolClient } from "pg";
import {
  decodeProveedorPosKey,
  encodeProveedorPosKey,
  isValidProveedorToken,
  normalizeProveedorToken,
  type ProveedorCatalogItem,
  type ProveedorVisitaOpen,
  type ProveedorVisitaRow,
} from "@/lib/proveedores/types";

export type ProveedorSedeQr = {
  sedeName: string;
  token: string;
  activo: boolean;
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
  id_cricla1: string;
  nombre: string;
}): ProveedorCatalogItem => ({
  id: encodeProveedorPosKey(row.empresa, row.id_cricla1),
  empresa: String(row.empresa),
  codigo: String(row.id_cricla1),
  nombre: String(row.nombre),
});

/**
 * Maestro POS (`proveedor_pos_catalogo`).
 * Deduplica por nombre (misma razón social en varias empresas) priorizando mercamio.
 */
export const searchProveedorCatalog = async (
  client: PoolClient,
  query: string,
  limit = 20,
): Promise<ProveedorCatalogItem[]> => {
  const q = query.trim().slice(0, 80);
  const capped = Math.min(Math.max(limit, 1), 50);
  const safeLike = q.replace(/[%_]/g, "");

  if (!safeLike) {
    const result = await client.query(
      `
      SELECT DISTINCT ON (lower(btrim(nombre)))
        empresa, id_cricla1, nombre
      FROM proveedor_pos_catalogo
      WHERE activo IS TRUE
        AND btrim(COALESCE(nombre, '')) <> ''
        AND lower(btrim(nombre)) <> '(sin proveedor)'
      ORDER BY
        lower(btrim(nombre)),
        CASE lower(btrim(empresa))
          WHEN 'mercamio' THEN 0
          WHEN 'mtodo' THEN 1
          WHEN 'bogota' THEN 2
          ELSE 9
        END,
        id_cricla1
      LIMIT $1
      `,
      [capped],
    );
    return (result.rows ?? []).map((row) =>
      mapCatalogRow(row as { empresa: string; id_cricla1: string; nombre: string }),
    );
  }

  const result = await client.query(
    `
    SELECT DISTINCT ON (lower(btrim(nombre)))
      empresa, id_cricla1, nombre
    FROM proveedor_pos_catalogo
    WHERE activo IS TRUE
      AND btrim(COALESCE(nombre, '')) <> ''
      AND lower(btrim(nombre)) <> '(sin proveedor)'
      AND (
        nombre ILIKE $1
        OR COALESCE(id_cricla1, '') ILIKE $1
        OR COALESCE(nit, '') ILIKE $1
      )
    ORDER BY
      lower(btrim(nombre)),
      CASE lower(btrim(empresa))
        WHEN 'mercamio' THEN 0
        WHEN 'mtodo' THEN 1
        WHEN 'bogota' THEN 2
        ELSE 9
      END,
      id_cricla1
    LIMIT $2
    `,
    [`%${safeLike}%`, capped],
  );
  return (result.rows ?? []).map((row) =>
    mapCatalogRow(row as { empresa: string; id_cricla1: string; nombre: string }),
  );
};

export const getProveedorById = async (
  client: PoolClient,
  id: unknown,
): Promise<ProveedorCatalogItem | null> => {
  const key = decodeProveedorPosKey(id);
  if (!key) return null;
  const result = await client.query(
    `
    SELECT empresa, id_cricla1, nombre
    FROM proveedor_pos_catalogo
    WHERE empresa = $1
      AND id_cricla1 = $2
      AND activo IS TRUE
    LIMIT 1
    `,
    [key.empresa, key.codigo],
  );
  const row = result.rows?.[0] as
    | { empresa?: string; id_cricla1?: string; nombre?: string }
    | undefined;
  if (!row?.empresa || !row.id_cricla1 || !row.nombre) return null;
  return mapCatalogRow({
    empresa: row.empresa,
    id_cricla1: row.id_cricla1,
    nombre: row.nombre,
  });
};

export const findOpenVisit = async (
  client: PoolClient,
  args: { sedeName: string; cedula: string },
): Promise<ProveedorVisitaOpen | null> => {
  const result = await client.query(
    `
    SELECT id, sede_name, proveedor_nombre, visitante_nombre, visitante_cedula, entrada_at
    FROM proveedor_visitas
    WHERE sede_name = $1
      AND visitante_cedula = $2
      AND salida_at IS NULL
    ORDER BY entrada_at DESC
    LIMIT 1
    `,
    [args.sedeName, args.cedula],
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
  },
): Promise<ProveedorVisitaOpen> => {
  const result = await client.query(
    `
    INSERT INTO proveedor_visitas (
      sede_name, proveedor_codigo, proveedor_empresa, proveedor_nombre,
      visitante_nombre, visitante_cedula, client_ip, user_agent
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
  const result = await client.query(
    `
    UPDATE proveedor_visitas
    SET salida_at = now()
    WHERE id = $1
      AND sede_name = $2
      AND visitante_cedula = $3
      AND salida_at IS NULL
    RETURNING id, sede_name, proveedor_nombre, visitante_nombre, visitante_cedula, entrada_at, salida_at
    `,
    [args.visitId, args.sedeName, args.cedula],
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
  args: {
    dateStart: string;
    dateEnd: string;
    sedeName?: string | null;
    q?: string | null;
    limit?: number;
  },
): Promise<ProveedorVisitaRow[]> => {
  const limit = Math.min(Math.max(args.limit ?? 500, 1), 2000);
  const params: unknown[] = [
    `${args.dateStart}T00:00:00`,
    `${args.dateEnd}T23:59:59.999`,
  ];
  const clauses = [`entrada_at >= $1::timestamptz`, `entrada_at <= $2::timestamptz`];
  if (args.sedeName) {
    params.push(args.sedeName);
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
  params.push(limit);
  const result = await client.query(
    `
    SELECT id, sede_name, proveedor_codigo, proveedor_empresa, proveedor_nombre,
           visitante_nombre, visitante_cedula, entrada_at, salida_at
    FROM proveedor_visitas
    WHERE ${clauses.join(" AND ")}
    ORDER BY entrada_at DESC
    LIMIT $${params.length}
    `,
    params,
  );
  return (result.rows ?? []).map((row) => mapVisitaRow(row as Record<string, unknown>));
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
): Promise<number> => {
  const result = await client.query(
    `
    SELECT count(*)::int AS n
    FROM proveedor_pos_catalogo
    WHERE activo IS TRUE
      AND btrim(COALESCE(nombre, '')) <> ''
      AND lower(btrim(nombre)) <> '(sin proveedor)'
    `,
  );
  return Number(result.rows?.[0]?.n ?? 0);
};
