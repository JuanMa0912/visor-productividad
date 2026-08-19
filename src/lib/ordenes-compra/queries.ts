import type { PoolClient } from "pg";
import {
  OC_SLA_DAYS,
  buildOcCumplimiento,
  EMPTY_OC_CUMPLIMIENTO,
  ocFlags,
  ocMatchesVista,
  ocPrimaryBadge,
  yyyymmddAddDays,
  yyyymmddDiffDays,
  yyyymmddToday,
  type OcVista,
} from "./status";
import { sortOcEmpresas, sortOcSedes } from "./filters";
import type {
  OrdenCompraBoard,
  OrdenCompraBreakdown,
  OrdenCompraRow,
} from "./types";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function uniqueTexts(...groups: Array<string[] | string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const values = Array.isArray(group) ? group : group ? [group] : [];
    for (const raw of values) {
      const value = raw.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

const ABIERTAS_SQL = `
  BTRIM(ind_estado) <> '2'
  AND COALESCE(cantidad_ent, 0) < COALESCE(cantidad, 0) - 0.0001
`;
const INCOMPLETAS_SQL = `
  BTRIM(ind_estado) <> '2'
  AND COALESCE(cantidad_ent, 0) > 0.0001
  AND COALESCE(cantidad_ent, 0) < COALESCE(cantidad, 0) - 0.0001
`;
const VENCIDAS_SQL = `
  BTRIM(ind_estado) <> '2'
  AND COALESCE(cantidad_ent, 0) < COALESCE(cantidad, 0) - 0.0001
  AND BTRIM(fecha_dcto) < to_char(CURRENT_DATE - ${OC_SLA_DAYS}, 'YYYYMMDD')
`;
const CERRADAS_SQL = `
  BTRIM(ind_estado) = '2'
  OR COALESCE(cantidad_ent, 0) >= COALESCE(cantidad, 0) - 0.0001
`;
const ABIERTAS_NO_VENCIDAS_SQL = `(${ABIERTAS_SQL}) AND NOT (${VENCIDAS_SQL})`;
const INCOMPLETAS_NO_VENCIDAS_SQL = `(${INCOMPLETAS_SQL}) AND NOT (${VENCIDAS_SQL})`;

function mapBreakdown(rows: Record<string, unknown>[]): OrdenCompraBreakdown[] {
  return rows.map((raw) => ({
    key: String(raw.key ?? ""),
    label: String(raw.label ?? raw.key ?? ""),
    count: num(raw.count),
    abiertas: num(raw.abiertas),
    vencidas: num(raw.vencidas),
    incompletas: num(raw.incompletas),
    totBruto: num(raw.tot_bruto),
  }));
}

export async function queryOrdenesCompraBoard(
  client: PoolClient,
  input: {
    vista: OcVista;
    q?: string | null;
    empresa?: string | null;
    empresas?: string[] | null;
    sede?: string | null;
    sedes?: string[] | null;
    proveedores?: string[] | null;
    tipdoc?: string | null;
    comprador?: string | null;
    desde?: string | null;
    hasta?: string | null;
    diaDesde?: number | null;
    diaHasta?: number | null;
    limit?: number;
  },
): Promise<OrdenCompraBoard> {
  const today = yyyymmddToday();
  const yesterday = yyyymmddAddDays(today, -1);
  const params: unknown[] = [];
  const where: string[] = [];

  const empresas = uniqueTexts(input.empresas, input.empresa);
  const sedes = uniqueTexts(input.sedes, input.sede);
  const proveedores = uniqueTexts(input.proveedores);
  if (empresas.length > 0) {
    params.push(empresas);
    where.push(`empresa = ANY($${params.length}::text[])`);
  }
  if (sedes.length > 0) {
    params.push(sedes);
    where.push(`sede = ANY($${params.length}::text[])`);
  }
  if (proveedores.length > 0) {
    params.push(proveedores);
    where.push(`COALESCE(terc_nombre, '') = ANY($${params.length}::text[])`);
  }
  if (input.tipdoc) {
    params.push(input.tipdoc.toUpperCase());
    where.push(`tipdoc = $${params.length}`);
  }
  if (input.comprador) {
    params.push(input.comprador);
    where.push(`comprador_nom = $${params.length}`);
  }
  if (input.desde) {
    params.push(input.desde);
    where.push(`fecha_dcto >= $${params.length}`);
  }
  if (input.hasta) {
    params.push(input.hasta);
    where.push(`fecha_dcto <= $${params.length}`);
  }
  if (input.q && input.q.trim()) {
    params.push(`%${input.q.trim()}%`);
    const i = params.length;
    where.push(
      `(documento_oc ILIKE $${i} OR COALESCE(terc_nombre,'') ILIKE $${i} OR COALESCE(id_terc,'') ILIKE $${i} OR COALESCE(usuario_conf,'') ILIKE $${i} OR COALESCE(terc_nit,'') ILIKE $${i} OR COALESCE(comprador_nom,'') ILIKE $${i})`,
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(input.limit ?? 1500, 1), 3000);

  const cumplimientoWhere = [...where];
  const cumplimientoParams = [...params];
  if (input.diaDesde != null) {
    cumplimientoParams.push(input.diaDesde);
    cumplimientoWhere.push(
      `BTRIM(fecha_dcto) ~ '^[0-9]{8}$' AND SUBSTRING(BTRIM(fecha_dcto) FROM 7 FOR 2)::int >= $${cumplimientoParams.length}`,
    );
  }
  if (input.diaHasta != null) {
    cumplimientoParams.push(input.diaHasta);
    cumplimientoWhere.push(
      `BTRIM(fecha_dcto) ~ '^[0-9]{8}$' AND SUBSTRING(BTRIM(fecha_dcto) FROM 7 FOR 2)::int <= $${cumplimientoParams.length}`,
    );
  }
  const cumplimientoWhereSql = cumplimientoWhere.length
    ? `WHERE ${cumplimientoWhere.join(" AND ")}`
    : "";

  const metaRes = await client.query(
    `
    SELECT
      ARRAY(SELECT DISTINCT empresa FROM orden_compra ORDER BY 1) AS empresas,
      ARRAY(SELECT DISTINCT sede FROM orden_compra WHERE sede IS NOT NULL ORDER BY 1) AS sedes,
      ARRAY(
        SELECT DISTINCT tipdoc || '|' || tipdoc_nom
        FROM orden_compra
        ORDER BY 1
      ) AS tipdocs,
      ARRAY(
        SELECT DISTINCT comprador_nom
        FROM orden_compra
        WHERE comprador_nom IS NOT NULL AND BTRIM(comprador_nom) <> ''
        ORDER BY 1
      ) AS compradores,
      ARRAY(
        SELECT terc_nombre
        FROM (
          SELECT terc_nombre, count(*) AS n
          FROM orden_compra
          WHERE terc_nombre IS NOT NULL AND BTRIM(terc_nombre) <> ''
          GROUP BY terc_nombre
          ORDER BY n DESC, terc_nombre
          LIMIT 800
        ) t
      ) AS proveedores,
      MAX(loaded_at)::text AS loaded_at
    FROM orden_compra
    `,
  );
  const metaRow = metaRes.rows[0] ?? {};
  const tipdocs = ((metaRow.tipdocs as string[] | null) ?? [])
    .map((raw) => {
      const [codigo, ...rest] = String(raw).split("|");
      return { codigo, nombre: rest.join("|") || codigo };
    })
    .filter((t) => t.codigo);

  const kpiRes = await client.query(
    `
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE ${ABIERTAS_SQL})::int AS abiertas,
      count(*) FILTER (WHERE ${INCOMPLETAS_SQL})::int AS incompletas,
      count(*) FILTER (WHERE ${VENCIDAS_SQL})::int AS vencidas,
      count(*) FILTER (
        WHERE BTRIM(ind_estado) = '2'
           OR COALESCE(cantidad_ent, 0) >= COALESCE(cantidad, 0) - 0.0001
      )::int AS cumplidas,
      count(*) FILTER (WHERE BTRIM(fecha_dcto) = to_char(CURRENT_DATE - 1, 'YYYYMMDD'))::int AS de_ayer,
      COALESCE(SUM(tot_bruto) FILTER (WHERE ${ABIERTAS_SQL}), 0)::float AS tot_bruto_abiertas,
      CASE
        WHEN COALESCE(SUM(cantidad) FILTER (WHERE ${ABIERTAS_SQL}), 0) > 0
        THEN (
          SUM(cantidad_ent) FILTER (WHERE ${ABIERTAS_SQL})
          / SUM(cantidad) FILTER (WHERE ${ABIERTAS_SQL})
        ) * 100
        ELSE 0
      END::float AS pct_recibida_abiertas
    FROM orden_compra
    ${whereSql}
    `,
    params,
  );
  const kpiRow = kpiRes.rows[0] ?? {};

  const breakdownSelect = `
    count(*)::int AS count,
    count(*) FILTER (WHERE ${ABIERTAS_SQL})::int AS abiertas,
    count(*) FILTER (WHERE ${VENCIDAS_SQL})::int AS vencidas,
    count(*) FILTER (WHERE ${INCOMPLETAS_SQL})::int AS incompletas,
    COALESCE(SUM(tot_bruto), 0)::float AS tot_bruto
  `;

  const [empresaBd, sedeBd, tipdocBd, dataRes, cumplimientoRes] = await Promise.all([
    client.query(
      `
      SELECT empresa AS key, empresa AS label, ${breakdownSelect}
      FROM orden_compra
      ${whereSql}
      GROUP BY empresa
      ORDER BY count DESC, empresa
      `,
      params,
    ),
    client.query(
      `
      SELECT
        COALESCE(NULLIF(BTRIM(sede), ''), id_co) AS key,
        COALESCE(NULLIF(BTRIM(sede), ''), id_co) AS label,
        ${breakdownSelect}
      FROM orden_compra
      ${whereSql}
      GROUP BY 1
      ORDER BY count DESC, label
      LIMIT 16
      `,
      params,
    ),
    client.query(
      `
      SELECT
        tipdoc AS key,
        COALESCE(MAX(tipdoc_nom), tipdoc) AS label,
        ${breakdownSelect}
      FROM orden_compra
      ${whereSql}
      GROUP BY tipdoc
      ORDER BY count DESC, tipdoc
      `,
      params,
    ),
    client.query(
      `
      SELECT
        empresa, id_co, sede, tipdoc, tipdoc_nom, documento_oc,
        fecha_dcto, fecha_entrega, id_terc, terc_nombre, terc_nit,
        ind_estado, estado_nom, usuario_conf, fecha_conf, hora_conf,
        comprador_nom, n_lineas, n_items, cantidad, cantidad_ent,
        tot_bruto, loaded_at::text AS loaded_at
      FROM orden_compra
      ${whereSql}
      ORDER BY fecha_dcto DESC, tipdoc, documento_oc, id_co
      LIMIT ${limit}
      `,
      params,
    ),
    client.query(
      `
      SELECT
        count(*) FILTER (WHERE (${CERRADAS_SQL}))::int AS cerradas_count,
        COALESCE(SUM(cantidad) FILTER (WHERE (${CERRADAS_SQL})), 0)::float AS cerradas_cant,
        count(*) FILTER (WHERE ${ABIERTAS_NO_VENCIDAS_SQL})::int AS abiertas_count,
        COALESCE(SUM(cantidad) FILTER (WHERE ${ABIERTAS_NO_VENCIDAS_SQL}), 0)::float AS abiertas_cant,
        COALESCE(SUM(cantidad_ent) FILTER (WHERE ${ABIERTAS_NO_VENCIDAS_SQL}), 0)::float AS abiertas_ent,
        count(*) FILTER (WHERE ${INCOMPLETAS_NO_VENCIDAS_SQL})::int AS incompletas_count,
        COALESCE(SUM(cantidad) FILTER (WHERE ${INCOMPLETAS_NO_VENCIDAS_SQL}), 0)::float AS incompletas_cant,
        COALESCE(SUM(cantidad_ent) FILTER (WHERE ${INCOMPLETAS_NO_VENCIDAS_SQL}), 0)::float AS incompletas_ent
      FROM orden_compra
      ${cumplimientoWhereSql}
      `,
      cumplimientoParams,
    ),
  ]);

  const rows: OrdenCompraRow[] = [];

  for (const raw of dataRes.rows) {
    const cantidad = num(raw.cantidad);
    const cantidadEnt = num(raw.cantidad_ent);
    const fechaDcto = String(raw.fecha_dcto ?? "");
    const flags = ocFlags({
      indEstado: String(raw.ind_estado ?? ""),
      cantidad,
      cantidadEnt,
      fechaDcto,
      todayYyyymmdd: today,
    });
    if (!ocMatchesVista(flags, input.vista, fechaDcto, yesterday)) continue;

    const fechaLimiteSla = yyyymmddAddDays(fechaDcto, OC_SLA_DAYS);
    rows.push({
      empresa: String(raw.empresa ?? ""),
      idCo: String(raw.id_co ?? ""),
      sede: raw.sede ? String(raw.sede) : null,
      tipdoc: String(raw.tipdoc ?? ""),
      tipdocNom: String(raw.tipdoc_nom ?? raw.tipdoc ?? ""),
      documentoOc: String(raw.documento_oc ?? ""),
      fechaDcto,
      fechaEntrega: raw.fecha_entrega ? String(raw.fecha_entrega) : null,
      fechaLimiteSla,
      diasSla: yyyymmddDiffDays(today, fechaLimiteSla),
      idTerc: raw.id_terc ? String(raw.id_terc) : null,
      tercNombre: raw.terc_nombre ? String(raw.terc_nombre) : null,
      tercNit: raw.terc_nit ? String(raw.terc_nit) : null,
      indEstado: String(raw.ind_estado ?? ""),
      estadoNom: raw.estado_nom ? String(raw.estado_nom) : null,
      usuarioConf: raw.usuario_conf ? String(raw.usuario_conf) : null,
      fechaConf: raw.fecha_conf ? String(raw.fecha_conf) : null,
      horaConf: raw.hora_conf ? String(raw.hora_conf) : null,
      compradorNom: raw.comprador_nom ? String(raw.comprador_nom) : null,
      nLineas: Math.round(num(raw.n_lineas)),
      nItems: Math.round(num(raw.n_items)),
      cantidad,
      cantidadEnt,
      pctRecibida: cantidad > 0 ? (cantidadEnt / cantidad) * 100 : 0,
      totBruto: num(raw.tot_bruto),
      loadedAt: raw.loaded_at ? String(raw.loaded_at) : null,
      ...flags,
      badge: ocPrimaryBadge(flags),
    });
  }

  return {
    meta: {
      empresas: sortOcEmpresas((metaRow.empresas as string[] | null) ?? []),
      sedes: sortOcSedes((metaRow.sedes as string[] | null) ?? []),
      proveedores: ((metaRow.proveedores as string[] | null) ?? []).filter(Boolean),
      tipdocs,
      compradores: (metaRow.compradores as string[] | null) ?? [],
      loadedAt: metaRow.loaded_at ? String(metaRow.loaded_at) : null,
      slaDays: OC_SLA_DAYS,
      truncated: dataRes.rows.length >= limit,
    },
    kpis: {
      total: num(kpiRow.total),
      abiertas: num(kpiRow.abiertas),
      incompletas: num(kpiRow.incompletas),
      vencidas: num(kpiRow.vencidas),
      cumplidas: num(kpiRow.cumplidas),
      deAyer: num(kpiRow.de_ayer),
      totBrutoAbiertas: num(kpiRow.tot_bruto_abiertas),
      pctRecibidaAbiertas: num(kpiRow.pct_recibida_abiertas),
    },
    cumplimiento: cumplimientoRes.rows[0]
      ? buildOcCumplimiento({
          cerradasCount: num(cumplimientoRes.rows[0].cerradas_count),
          cerradasCantidad: num(cumplimientoRes.rows[0].cerradas_cant),
          abiertasCount: num(cumplimientoRes.rows[0].abiertas_count),
          abiertasCantidad: num(cumplimientoRes.rows[0].abiertas_cant),
          abiertasEnt: num(cumplimientoRes.rows[0].abiertas_ent),
          incompletasCount: num(cumplimientoRes.rows[0].incompletas_count),
          incompletasCantidad: num(cumplimientoRes.rows[0].incompletas_cant),
          incompletasEnt: num(cumplimientoRes.rows[0].incompletas_ent),
        })
      : EMPTY_OC_CUMPLIMIENTO,
    breakdowns: {
      empresa: mapBreakdown(empresaBd.rows),
      sede: mapBreakdown(sedeBd.rows),
      tipdoc: mapBreakdown(tipdocBd.rows),
    },
    rows,
  };
}
