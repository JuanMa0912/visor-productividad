import type { ClientBase } from "pg";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

export const INFORME_SIN_MARCA_LABEL = "(Sin marca)";

const itemCodeFromLabel = (label: string): string =>
  (label.trim().split(/\s+/)[0] ?? "").trim();

const probeProveedorItemTable = async (client: ClientBase): Promise<boolean> => {
  const result = await client.query<{ ok: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'proveedor_item'
    ) AS ok
  `);
  return Boolean(result.rows[0]?.ok);
};

/**
 * Marca comercial más frecuente por ítem (`proveedor_item.marca`), igual que Costos.
 */
const lookupMarcaByItemIds = async (
  client: ClientBase,
  itemIds: string[],
): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  const ids = [...new Set(itemIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) return out;
  if (!(await probeProveedorItemTable(client))) return out;

  const result = await client.query<{ id_item: string; marca: string }>(
    `
    WITH ranked AS (
      SELECT
        BTRIM(pi.id_item) AS id_item,
        BTRIM(pi.marca) AS marca,
        COUNT(*)::int AS hits
      FROM proveedor_item pi
      WHERE BTRIM(pi.id_item) = ANY($1::text[])
        AND NULLIF(BTRIM(COALESCE(pi.marca, '')), '') IS NOT NULL
      GROUP BY 1, 2
    )
    SELECT DISTINCT ON (id_item)
      id_item,
      marca
    FROM ranked
    ORDER BY id_item, hits DESC, marca ASC
    `,
    [ids],
  );

  for (const row of result.rows ?? []) {
    const id = String(row.id_item ?? "").trim();
    const marca = String(row.marca ?? "").trim();
    if (!id || !marca) continue;
    out.set(id, marca);
  }
  return out;
};

/**
 * Adjunta diccionario de marcas y el mapa ítem→marca.
 * No agranda las filas compactas: se resuelve por índice de ítem.
 */
export const attachInformeMarcas = async (
  client: ClientBase,
  payload: InformeVariacionPayload,
): Promise<InformeVariacionPayload> => {
  const itemIds = (payload.itemIds ?? payload.items.map(itemCodeFromLabel)).map(
    (id) => String(id ?? "").trim(),
  );
  const uniqueIds = [...new Set(itemIds.filter(Boolean))];
  const lookup = await lookupMarcaByItemIds(client, uniqueIds);

  const marcas: string[] = [INFORME_SIN_MARCA_LABEL];
  const marcaIndex = new Map<string, number>([[INFORME_SIN_MARCA_LABEL, 0]]);
  const itemMarca: number[] = payload.items.map((_, index) => {
    const code = itemIds[index] ?? "";
    const label = (code ? lookup.get(code) : undefined)?.trim() || INFORME_SIN_MARCA_LABEL;
    const existing = marcaIndex.get(label);
    if (existing !== undefined) return existing;
    const next = marcas.length;
    marcas.push(label);
    marcaIndex.set(label, next);
    return next;
  });

  return {
    ...payload,
    itemIds,
    marcas,
    itemMarca,
  };
};

export const informePayloadHasMarcas = (
  payload: InformeVariacionPayload,
): boolean =>
  Array.isArray(payload.marcas) &&
  Array.isArray(payload.itemMarca) &&
  payload.itemMarca.length === payload.items.length;

export const ensureInformeMarcas = async (
  client: ClientBase,
  payload: InformeVariacionPayload,
): Promise<InformeVariacionPayload> => {
  if (informePayloadHasMarcas(payload)) return payload;
  return attachInformeMarcas(client, payload);
};

export const ensureInformeMarcasOnMap = async (
  client: ClientBase,
  payloads: Record<string, InformeVariacionPayload>,
): Promise<Record<string, InformeVariacionPayload>> => {
  const next: Record<string, InformeVariacionPayload> = {};
  for (const [key, payload] of Object.entries(payloads)) {
    next[key] = await ensureInformeMarcas(client, payload);
  }
  return next;
};
