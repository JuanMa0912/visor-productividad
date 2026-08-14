import type { PoolClient } from "pg";

export type ItemProveedorInfo = {
  id: string | null;
  label: string | null;
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
 * + `proveedor_pos_catalogo`. Si un ítem tiene varios nombres entre empresas,
 * toma el más frecuente.
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
  }>(
    `
    WITH ranked AS (
      SELECT
        BTRIM(pi.id_item) AS id_item,
        COALESCE(NULLIF(BTRIM(pi.id_cricla1), ''), '@SP') AS proveedor_id,
        COALESCE(
          NULLIF(BTRIM(pc.nombre), ''),
          NULLIF(BTRIM(pi.descripcion), ''),
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
    )
    SELECT DISTINCT ON (id_item)
      id_item,
      proveedor_id,
      proveedor_label
    FROM ranked
    ORDER BY id_item, hits DESC, proveedor_label ASC
    `,
    params,
  );

  for (const row of result.rows ?? []) {
    const id = String(row.id_item ?? "").trim();
    if (!id) continue;
    out.set(id, {
      id: String(row.proveedor_id ?? "").trim() || null,
      label: String(row.proveedor_label ?? "").trim() || null,
    });
  }
  return out;
};
