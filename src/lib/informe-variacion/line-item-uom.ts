import type { InformeRowIndex } from "@/lib/informe-variacion/row-index";

export type ItemUomKind = "count" | "mass_kg" | "volume_l";

export type ResolvedItemUom = {
  kind: ItemUomKind;
  /** Multiplicador sobre cantidad BD para expresar en kilos o litros. */
  factor: number;
};

const DISPLAY_LABEL: Record<Exclude<ItemUomKind, "count">, string> = {
  mass_kg: "kilos",
  volume_l: "litros",
};

const COUNT_UNIT_IDS =
  /^(UND|UNID|UNIDAD|UN|U|EA|PZA|PIEZA|PQT|PQTE|EMPAQ|PR|PRESA)?$/i;

const normalizeUomText = (value: string): string =>
  value.toUpperCase().replace(/,/g, ".");

const parsePackNumber = (raw: string): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Clasifica la unidad de un ítem a partir de descripción (*KILO, *900ml) e id_unidad.
 * Los empaques con tamaño (*900ml) asumen cantidad = número de empaques.
 * Los ítems *KILO / *LITRO asumen cantidad ya en esa unidad base.
 */
export const resolveItemUom = (
  itemLabel: string,
  unitId = "",
): ResolvedItemUom => {
  const text = normalizeUomText(`${itemLabel} ${unitId}`);
  const um = (unitId ?? "").trim().toUpperCase();

  if (/\*(\d{1,4})\s*UND\b/.test(text) || /\*UND\b/.test(text)) {
    return { kind: "count", factor: 1 };
  }

  if (/\*(KILO|KG)\b/.test(text)) {
    return { kind: "mass_kg", factor: 1 };
  }

  if (/\*(LITRO|LITROS|LT)\b/.test(text)) {
    return { kind: "volume_l", factor: 1 };
  }

  const grPack = /\*(\d+(?:\.\d+)?)\s*GR(?:AMOS?)?\b/.exec(text);
  if (grPack) {
    return { kind: "mass_kg", factor: parsePackNumber(grPack[1]!) / 1000 };
  }

  const kgPack = /\*(\d+(?:\.\d+)?)\s*KG\b/.exec(text);
  if (kgPack) {
    return { kind: "mass_kg", factor: parsePackNumber(kgPack[1]!) };
  }

  const mlPack = /\*(\d+(?:\.\d+)?)\s*ML\b/.exec(text);
  if (mlPack) {
    return { kind: "volume_l", factor: parsePackNumber(mlPack[1]!) / 1000 };
  }

  const ltPack = /\*(\d+(?:\.\d+)?)\s*(?:LT|LITROS?)\b/.exec(text);
  if (ltPack) {
    return { kind: "volume_l", factor: parsePackNumber(ltPack[1]!) };
  }

  if (/\b(KILO|KG)\b/.test(um)) {
    return { kind: "mass_kg", factor: 1 };
  }

  if (/\b(LITRO|LITROS|LT)\b/.test(um)) {
    return { kind: "volume_l", factor: 1 };
  }

  if (COUNT_UNIT_IDS.test(um)) {
    if (/\bKILO\b/.test(text)) return { kind: "mass_kg", factor: 1 };
    if (/\b(LITRO|LITROS)\b/.test(text)) return { kind: "volume_l", factor: 1 };
    return { kind: "count", factor: 1 };
  }

  return { kind: "count", factor: 1 };
};

export const displayLabelForItemUomKind = (
  kind: ItemUomKind,
): string | null => {
  if (kind === "count") return null;
  return DISPLAY_LABEL[kind];
};

/** Si todos los ítems comparten kilos o litros, devuelve la etiqueta de display. */
export const resolveGroupDisplayUom = (
  itemIndices: readonly number[],
  ctx: { items: string[]; ums: string[] },
): string | null => {
  if (itemIndices.length === 0) return null;

  let kind: ItemUomKind | null = null;
  for (const index of itemIndices) {
    const resolved = resolveItemUom(ctx.items[index] ?? "", ctx.ums[index] ?? "");
    if (resolved.kind === "count") return null;
    if (kind === null) kind = resolved.kind;
    else if (kind !== resolved.kind) return null;
  }

  return kind ? displayLabelForItemUomKind(kind) : null;
};

export const convertQtyToGroupUom = (
  qty: number,
  itemLabel: string,
  unitId: string,
  displayLabel: string,
): number => {
  if (!Number.isFinite(qty) || qty === 0) return 0;

  const resolved = resolveItemUom(itemLabel, unitId);
  const expectedKind: ItemUomKind =
    displayLabel === "kilos" ? "mass_kg" : displayLabel === "litros" ? "volume_l" : "count";
  if (expectedKind === "count" || resolved.kind !== expectedKind) return 0;

  return qty * resolved.factor;
};

export type InformeLineUomIndex = {
  lineDisplayUom: ReadonlyMap<number, string>;
  sublineDisplayUom: ReadonlyMap<string, string>;
};

export const buildInformeLineUomIndex = (
  rowIndex: InformeRowIndex,
  ctx: { items: string[]; ums: string[] },
): InformeLineUomIndex => {
  const lineDisplayUom = new Map<number, string>();
  const sublineDisplayUom = new Map<string, string>();
  const lineItems = new Map<number, Set<number>>();

  for (const [catLinSub, itemIndices] of rowIndex.itemsByCatLinSub) {
    const parts = catLinSub.split("|");
    if (parts.length !== 3) continue;
    const lin = Number(parts[1]);
    const sub = Number(parts[2]);
    if (!Number.isFinite(lin) || !Number.isFinite(sub)) continue;

    const subLabel = resolveGroupDisplayUom(itemIndices, ctx);
    if (subLabel) sublineDisplayUom.set(`${lin}|${sub}`, subLabel);

    let bucket = lineItems.get(lin);
    if (!bucket) {
      bucket = new Set<number>();
      lineItems.set(lin, bucket);
    }
    for (const itemIndex of itemIndices) bucket.add(itemIndex);
  }

  for (const [lin, itemIndices] of lineItems) {
    const label = resolveGroupDisplayUom([...itemIndices], ctx);
    if (label) lineDisplayUom.set(lin, label);
  }

  return { lineDisplayUom, sublineDisplayUom };
};
