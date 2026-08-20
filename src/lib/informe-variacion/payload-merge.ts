import type {
  InformeCompactRow,
  InformeVariacionPayload,
} from "@/lib/informe-variacion/types";

const METRIC_INDEXES = [5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

export const sumInformePayloadCurrentValue = (
  payload: InformeVariacionPayload,
): number => payload.rows.reduce((sum, row) => sum + (row[8] ?? 0), 0);

const indexLabel = (list: string[], label: string): number => {
  const existing = list.indexOf(label);
  if (existing >= 0) return existing;
  list.push(label);
  return list.length - 1;
};

const rowIdentity = (
  payload: InformeVariacionPayload,
  row: InformeCompactRow,
): string =>
  [
    payload.sedes[row[0]]?.key ?? String(row[0]),
    payload.cats[row[1]] ?? "",
    payload.lins[row[2]] ?? "",
    payload.subs[row[3]] ?? "",
    payload.itemIds?.[row[4]] || payload.items[row[4]] || "",
  ].join("\u0001");

/**
 * Suma métricas de `extra` sobre `base` (mismo grano sede×ítem).
 * Sirve para armar 1→N = corte Excel cerrado + días posteriores.
 */
export const addInformePayloadMetrics = (
  base: InformeVariacionPayload,
  extra: InformeVariacionPayload,
): InformeVariacionPayload => {
  const cats = [...base.cats];
  const lins = [...base.lins];
  const subs = [...base.subs];
  const items = [...base.items];
  const itemIds = [...(base.itemIds ?? [])];
  const ums = [...(base.ums ?? [])];
  const sedeIndexByKey = new Map(
    base.sedes.map((sede, index) => [sede.key, index] as const),
  );

  const merged = new Map<string, InformeCompactRow>();
  for (const row of base.rows) {
    merged.set(rowIdentity(base, row), [...row] as InformeCompactRow);
  }

  for (const row of extra.rows) {
    const sedeKey = extra.sedes[row[0]]?.key;
    const sedeIdx = sedeKey ? sedeIndexByKey.get(sedeKey) : undefined;
    if (sedeIdx == null) continue;

    const catIdx = indexLabel(cats, extra.cats[row[1]] ?? "");
    const linIdx = indexLabel(lins, extra.lins[row[2]] ?? "");
    const subIdx = indexLabel(subs, extra.subs[row[3]] ?? "");
    const itemCode = extra.itemIds?.[row[4]] || extra.items[row[4]] || "";
    const itemLabel = extra.items[row[4]] ?? itemCode;
    let itemIdx = extra.itemIds?.[row[4]]
      ? itemIds.indexOf(extra.itemIds[row[4]]!)
      : items.indexOf(itemLabel);
    if (itemIdx < 0) {
      itemIdx = items.length;
      items.push(itemLabel);
      itemIds[itemIdx] = extra.itemIds?.[row[4]] ?? "";
      ums[itemIdx] = extra.ums?.[row[4]] ?? "";
    }

    const identity = [base.sedes[sedeIdx]?.key, cats[catIdx], lins[linIdx], subs[subIdx], itemIds[itemIdx] || items[itemIdx]].join("\u0001");
    const prev = merged.get(identity);
    if (!prev) {
      merged.set(identity, [
        sedeIdx,
        catIdx,
        linIdx,
        subIdx,
        itemIdx,
        row[5],
        row[6],
        row[7],
        row[8],
        row[9],
        row[10],
        row[11],
        row[12],
        row[13],
      ]);
      continue;
    }
    for (const index of METRIC_INDEXES) {
      prev[index] = (prev[index] ?? 0) + (row[index] ?? 0);
    }
  }

  const rows = [...merged.values()];
  return {
    ...base,
    cats,
    lins,
    subs,
    items,
    itemIds,
    ums,
    rows,
    meta: {
      ...base.meta,
      rowCount: rows.length,
    },
  };
};
