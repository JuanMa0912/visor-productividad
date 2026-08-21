import type { PoolClient } from "pg";

export type ItemProveedorInfo = {
  id: string | null;
  label: string | null;
};

const GENERIC_EMPRESA_PROVEEDOR_LABELS = new Set([
  "mercamio",
  "mercatodo",
  "merkmios",
  "bogota",
  "bogotá",
  "comercializadora",
]);

export const isGenericEmpresaProveedorLabel = (label: string): boolean =>
  GENERIC_EMPRESA_PROVEEDOR_LABELS.has(label.trim().toLowerCase());

/**
 * Prefiere el criterio POS (MERCAMIO FRUVER) sobre el nombre corto de empresa
 * (MERCAMIO). Si hay empate, el más largo y luego el más frecuente.
 */
export const compareProveedorLabelPreference = (
  a: { label: string; hits: number },
  b: { label: string; hits: number },
): number => {
  const genericA = isGenericEmpresaProveedorLabel(a.label) ? 1 : 0;
  const genericB = isGenericEmpresaProveedorLabel(b.label) ? 1 : 0;
  if (genericA !== genericB) return genericA - genericB;
  if (b.hits !== a.hits) return b.hits - a.hits;
  if (b.label.length !== a.label.length) return b.label.length - a.label.length;
  return a.label.localeCompare(b.label, "es");
};

export const pickPreferredProveedorCandidate = <
  T extends { label: string; hits: number },
>(
  candidates: T[],
): T | undefined => {
  if (candidates.length === 0) return undefined;
  return [...candidates].sort(compareProveedorLabelPreference)[0];
};

const proveedorTableExistsCache: {
  value: boolean | null;
  expiresAt: number;
} = { value: null, expiresAt: 0 };

const probeProveedorItemTable = async (
  client: PoolClient,
): Promise<boolean> => {
  const now = Date.now();
  if (
    proveedorTableExistsCache.value != null &&
    proveedorTableExistsCache.expiresAt > now
  ) {
    return proveedorTableExistsCache.value;
  }
  const result = await client.query<{ ok: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'proveedor_item'
    ) AS ok
  `);
  const ok = Boolean(result.rows[0]?.ok);
  proveedorTableExistsCache.value = ok;
  proveedorTableExistsCache.expiresAt = now + 5 * 60_000;
  return ok;
};

/**
 * Resuelve proveedor comercial (criterio POS) por ítem via `proveedor_item`
 * + `proveedor_pos_catalogo`. Prefiere el criterio (MERCAMIO FRUVER) y no el
 * nombre genérico de empresa (MERCAMIO).
 */
export const lookupProveedorByItemIds = async (
  client: PoolClient,
  itemIds: string[],
  empresas?: string[] | null,
): Promise<Map<string, ItemProveedorInfo>> => {
  const out = new Map<string, ItemProveedorInfo>();
  const ids = [
    ...new Set(
      itemIds
        .map((id) => String(id ?? "").trim())
        .filter((id) => id && !id.startsWith("__")),
    ),
  ];
  if (ids.length === 0) return out;

  const exists = await probeProveedorItemTable(client);
  if (!exists) return out;

  const params: unknown[] = [ids];
  let empresaSql = "";
  if (empresas && empresas.length > 0) {
    params.push(empresas.map((e) => e.toLowerCase()));
    empresaSql = ` AND LOWER(TRIM(pi.empresa)) = ANY($${params.length}::text[])`;
  }

  const result = await client.query<{
    id_item: string;
    proveedor_id: string;
    proveedor_label: string;
    hits: string | number;
  }>(
    `
    SELECT
      BTRIM(pi.id_item) AS id_item,
      COALESCE(NULLIF(BTRIM(pi.id_cricla1), ''), '@SP') AS proveedor_id,
      COALESCE(
        NULLIF(BTRIM(pi.descripcion), ''),
        NULLIF(BTRIM(pc.nombre), ''),
        NULLIF(BTRIM(pi.id_cricla1), ''),
        '(Sin proveedor)'
      ) AS proveedor_label,
      COUNT(*)::int AS hits
    FROM proveedor_item pi
    LEFT JOIN proveedor_pos_catalogo pc
      ON pc.empresa = pi.empresa
     AND pc.id_cricla1 = pi.id_cricla1
    WHERE BTRIM(pi.id_item) = ANY($1::text[])
      ${empresaSql}
    GROUP BY 1, 2, 3
    `,
    params,
  );

  const byItem = new Map<
    string,
    Array<{ id: string; label: string; hits: number }>
  >();
  for (const row of result.rows ?? []) {
    const id = String(row.id_item ?? "").trim();
    if (!id) continue;
    const list = byItem.get(id) ?? [];
    list.push({
      id: String(row.proveedor_id ?? "").trim(),
      label: String(row.proveedor_label ?? "").trim(),
      hits: Number(row.hits) || 0,
    });
    byItem.set(id, list);
  }

  for (const [id, candidates] of byItem) {
    const picked = pickPreferredProveedorCandidate(candidates);
    if (!picked) continue;
    out.set(id, {
      id: picked.id || null,
      label: picked.label || null,
    });
  }
  return out;
};
