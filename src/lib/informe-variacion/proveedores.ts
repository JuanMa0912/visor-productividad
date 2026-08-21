import type { ClientBase } from "pg";
import { stripEmpresaProveedorLabel } from "@/lib/exp-precios-proveedor/labels";
import { compactToIso } from "@/lib/informe-variacion/date-range";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

export const INFORME_SIN_PROVEEDOR_LABEL = "(Sin proveedor)";

export type InformeProveedorSource = "tercero" | "oc" | "criterio";

export type InformeProveedorCandidate = {
  label: string;
  hits: number;
  source: InformeProveedorSource;
};

const SOURCE_RANK: Record<InformeProveedorSource, number> = {
  tercero: 0,
  oc: 1,
  criterio: 2,
};

const itemCodeFromLabel = (label: string): string =>
  (label.trim().split(/\s+/)[0] ?? "").trim();

const displayProveedorLabel = (label: string): string => {
  const stripped = stripEmpresaProveedorLabel(label);
  return stripped || INFORME_SIN_PROVEEDOR_LABEL;
};

/** Criterio POS de departamento (MERCAMIO FRUVER), no un tercero individual. */
export const isCriterioDepartamentoProveedorLabel = (label: string): boolean => {
  const raw = String(label ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return true;
  return /^(mercamio|mercamios|mercatodo|mtodo|merkmios|bogota|bogotá)\b/i.test(
    raw,
  );
};

export const pickInformeProveedorCandidate = (
  candidates: InformeProveedorCandidate[],
): InformeProveedorCandidate | undefined => {
  if (candidates.length === 0) return undefined;
  const usable = candidates.filter(
    (candidate) =>
      candidate.source !== "criterio" &&
      !isCriterioDepartamentoProveedorLabel(candidate.label),
  );
  const pool = usable.length > 0 ? usable : candidates;
  return [...pool].sort((a, b) => {
    const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (bySource !== 0) return bySource;
    if (b.hits !== a.hits) return b.hits - a.hits;
    return displayProveedorLabel(a.label).localeCompare(
      displayProveedorLabel(b.label),
      "es",
    );
  })[0];
};

const shiftCompactDays = (compact: string, days: number): string => {
  const iso = compactToIso(compact);
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return compact;
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

const probeInformeProveedorTables = async (client: ClientBase) => {
  const result = await client.query<{
    proveedor_item: boolean;
    proveedor_tercero: boolean;
    oc: boolean;
  }>(
    `
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'proveedor_item'
      ) AS proveedor_item,
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'proveedor_tercero'
      ) AS proveedor_tercero,
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'orden_compra_linea'
      ) AS oc
    `,
  );
  return {
    proveedorItem: Boolean(result.rows[0]?.proveedor_item),
    proveedorTercero: Boolean(result.rows[0]?.proveedor_tercero),
    oc: Boolean(result.rows[0]?.oc),
  };
};

const lookupInformeProveedorByItemIds = async (
  client: ClientBase,
  itemIds: string[],
  range: { from: string; to: string } | null,
): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  const ids = [
    ...new Set(itemIds.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ];
  if (ids.length === 0) return out;

  const schema = await probeInformeProveedorTables(client);
  const byItem = new Map<string, InformeProveedorCandidate[]>();
  const push = (id: string, candidate: InformeProveedorCandidate) => {
    const label = candidate.label.trim();
    if (!id || !label) return;
    const list = byItem.get(id) ?? [];
    list.push({ ...candidate, label });
    byItem.set(id, list);
  };

  if (schema.proveedorItem) {
    const terceroJoin = schema.proveedorTercero
      ? `
      LEFT JOIN LATERAL (
        SELECT
          BTRIM(pt.codigo) AS codigo,
          NULLIF(BTRIM(pt.nombre), '') AS nombre
        FROM proveedor_tercero pt
        WHERE pt.empresa = pi.empresa
          AND pt.activo IS TRUE
          AND NULLIF(BTRIM(pc.nit), '') IS NOT NULL
          AND BTRIM(pc.nit) NOT IN ('99999999', '0')
          AND pt.nit = BTRIM(pc.nit)
        ORDER BY
          CASE WHEN BTRIM(COALESCE(pt.sucursal, '00')) IN ('', '00') THEN 0 ELSE 1 END,
          pt.sucursal
        LIMIT 1
      ) pt ON TRUE
      `
      : "";
    const result = await client.query<{
      id_item: string;
      proveedor_label: string;
      source: string;
      hits: string | number;
    }>(
      `
      SELECT
        BTRIM(pi.id_item) AS id_item,
        COALESCE(
          ${schema.proveedorTercero ? "NULLIF(BTRIM(pt.nombre), '')," : ""}
          NULLIF(BTRIM(pc.nombre), ''),
          NULLIF(BTRIM(pi.descripcion), ''),
          '(Sin proveedor)'
        ) AS proveedor_label,
        CASE
          WHEN ${
            schema.proveedorTercero
              ? "NULLIF(BTRIM(pt.nombre), '') IS NOT NULL"
              : "FALSE"
          }
            THEN 'tercero'
          ELSE 'criterio'
        END AS source,
        COUNT(*)::int AS hits
      FROM proveedor_item pi
      LEFT JOIN proveedor_pos_catalogo pc
        ON pc.empresa = pi.empresa
       AND pc.id_cricla1 = pi.id_cricla1
      ${terceroJoin}
      WHERE BTRIM(pi.id_item) = ANY($1::text[])
      GROUP BY 1, 2, 3
      `,
      [ids],
    );
    for (const row of result.rows ?? []) {
      const source: InformeProveedorSource =
        row.source === "tercero" ? "tercero" : "criterio";
      push(String(row.id_item ?? "").trim(), {
        label: String(row.proveedor_label ?? "").trim(),
        hits: Number(row.hits) || 0,
        source,
      });
    }
  }

  const needsOc = ids.filter((id) => {
    const picked = pickInformeProveedorCandidate(byItem.get(id) ?? []);
    return !picked || picked.source === "criterio";
  });

  if (schema.oc && needsOc.length > 0 && range) {
    const ocFrom = shiftCompactDays(range.from, -90);
    const ocResult = await client.query<{
      id_item: string;
      proveedor_label: string;
      hits: string | number;
    }>(
      `
      SELECT
        BTRIM(id_item) AS id_item,
        COALESCE(
          NULLIF(BTRIM(MAX(terc_nombre)), ''),
          NULLIF(BTRIM(id_terc), ''),
          '(Sin proveedor)'
        ) AS proveedor_label,
        COUNT(*)::int AS hits
      FROM orden_compra_linea
      WHERE BTRIM(id_item) = ANY($1::text[])
        AND NULLIF(BTRIM(id_terc), '') IS NOT NULL
        AND fecha_dcto >= $2
        AND fecha_dcto <= $3
      GROUP BY BTRIM(id_item), BTRIM(id_terc)
      `,
      [needsOc, ocFrom, range.to],
    );
    for (const row of ocResult.rows ?? []) {
      push(String(row.id_item ?? "").trim(), {
        label: String(row.proveedor_label ?? "").trim(),
        hits: Number(row.hits) || 0,
        source: "oc",
      });
    }
  }

  for (const [id, candidates] of byItem) {
    const picked = pickInformeProveedorCandidate(candidates);
    if (!picked) continue;
    out.set(id, displayProveedorLabel(picked.label));
  }
  return out;
};

/**
 * Adjunta diccionario de proveedores y el mapa ítem→proveedor.
 * Misma idea que Costos: tercero comercial / OC, no el criterio POS
 * (MERCAMIO FRUVER).
 */
export const attachInformeProveedores = async (
  client: ClientBase,
  payload: InformeVariacionPayload,
): Promise<InformeVariacionPayload> => {
  const itemIds = (payload.itemIds ?? payload.items.map(itemCodeFromLabel)).map(
    (id) => String(id ?? "").trim(),
  );
  const uniqueIds = [...new Set(itemIds.filter(Boolean))];
  const current = payload.periods?.current;
  const range =
    current?.from && current?.to
      ? { from: current.from, to: current.to }
      : null;
  const lookup = await lookupInformeProveedorByItemIds(client, uniqueIds, range);

  const provs: string[] = [INFORME_SIN_PROVEEDOR_LABEL];
  const provIndex = new Map<string, number>([[INFORME_SIN_PROVEEDOR_LABEL, 0]]);
  const itemProv: number[] = payload.items.map((_, index) => {
    const code = itemIds[index] ?? "";
    const label =
      (code ? lookup.get(code) : undefined)?.trim() ||
      INFORME_SIN_PROVEEDOR_LABEL;
    const existing = provIndex.get(label);
    if (existing !== undefined) return existing;
    const next = provs.length;
    provs.push(label);
    provIndex.set(label, next);
    return next;
  });

  return {
    ...payload,
    itemIds,
    provs,
    itemProv,
  };
};

export const informePayloadHasProveedores = (
  payload: InformeVariacionPayload,
): boolean =>
  Array.isArray(payload.provs) &&
  Array.isArray(payload.itemProv) &&
  payload.itemProv.length === payload.items.length;

export const ensureInformeProveedores = async (
  client: ClientBase,
  payload: InformeVariacionPayload,
): Promise<InformeVariacionPayload> => attachInformeProveedores(client, payload);

export const ensureInformeProveedoresOnMap = async (
  client: ClientBase,
  payloads: Record<string, InformeVariacionPayload>,
): Promise<Record<string, InformeVariacionPayload>> => {
  const next: Record<string, InformeVariacionPayload> = {};
  for (const [key, payload] of Object.entries(payloads)) {
    next[key] = await ensureInformeProveedores(client, payload);
  }
  return next;
};
