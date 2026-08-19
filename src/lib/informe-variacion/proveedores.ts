import type { ClientBase } from "pg";
import { lookupProveedorByItemIds } from "@/lib/analisis-inventario/item-proveedor";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

export const INFORME_SIN_PROVEEDOR_LABEL = "(Sin proveedor)";

const itemCodeFromLabel = (label: string): string =>
  (label.trim().split(/\s+/)[0] ?? "").trim();

/**
 * Adjunta diccionario de proveedores y el mapa ítem→proveedor.
 * No agranda las filas compactas: se resuelve por índice de ítem.
 */
export const attachInformeProveedores = async (
  client: ClientBase,
  payload: InformeVariacionPayload,
): Promise<InformeVariacionPayload> => {
  const itemIds = (payload.itemIds ?? payload.items.map(itemCodeFromLabel)).map(
    (id) => String(id ?? "").trim(),
  );
  const uniqueIds = [...new Set(itemIds.filter(Boolean))];
  const lookup = await lookupProveedorByItemIds(
    client as Parameters<typeof lookupProveedorByItemIds>[0],
    uniqueIds,
  );

  const provs: string[] = [INFORME_SIN_PROVEEDOR_LABEL];
  const provIndex = new Map<string, number>([[INFORME_SIN_PROVEEDOR_LABEL, 0]]);
  const itemProv: number[] = payload.items.map((_, index) => {
    const code = itemIds[index] ?? "";
    const hit = code ? lookup.get(code) : undefined;
    const label =
      hit?.label?.trim() ||
      hit?.id?.trim() ||
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
): Promise<InformeVariacionPayload> => {
  if (informePayloadHasProveedores(payload)) return payload;
  return attachInformeProveedores(client, payload);
};

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
