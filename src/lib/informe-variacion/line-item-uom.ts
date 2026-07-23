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
  /^(UND|UNID|UNIDAD|UN|U|EA|PZA|PIEZA|PQT|PQTE|EMPAQ|PR|PRESA|BOT|BOTELLA|BOLSA|CAJA|PACK|PAR)?$/i;

const normalizeUomText = (value: string): string =>
  value.toUpperCase().replace(/,/g, ".");

const parsePackNumber = (raw: string): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Empaque contado explícito (*12und, *und). */
export const isExplicitCountItem = (text: string): boolean =>
  /\*(\d{1,4})\s*UND\b/.test(text) || /\*UND\b/.test(text);

const toKg = {
  mg: (n: number) => n / 1_000_000,
  g: (n: number) => n / 1000,
  gr: (n: number) => n / 1000,
  kg: (n: number) => n,
};

const toLiters = {
  ml: (n: number) => n / 1000,
  cc: (n: number) => n / 1000,
  cl: (n: number) => n / 100,
  lt: (n: number) => n,
  l: (n: number) => n,
};

type PackRule = {
  pattern: RegExp;
  kind: Exclude<ItemUomKind, "count">;
  toBase: (n: number) => number;
};

const STAR_PACK_RULES: PackRule[] = [
  { pattern: /\*(\d+(?:\.\d+)?)\s*MG\b/, kind: "mass_kg", toBase: toKg.mg },
  { pattern: /\*(\d+(?:\.\d+)?)\s*GR(?:AMOS?)?\b/, kind: "mass_kg", toBase: toKg.gr },
  { pattern: /\*(\d+(?:\.\d+)?)\s*G\b/, kind: "mass_kg", toBase: toKg.g },
  { pattern: /\*(\d+(?:\.\d+)?)\s*KG\b/, kind: "mass_kg", toBase: toKg.kg },
  { pattern: /\*(\d+(?:\.\d+)?)\s*ML\b/, kind: "volume_l", toBase: toLiters.ml },
  { pattern: /\*(\d+(?:\.\d+)?)\s*CC\b/, kind: "volume_l", toBase: toLiters.cc },
  { pattern: /\*(\d+(?:\.\d+)?)\s*CL\b/, kind: "volume_l", toBase: toLiters.cl },
  { pattern: /\*(\d+(?:\.\d+)?)\s*(?:LT|LITROS?)\b/, kind: "volume_l", toBase: toLiters.lt },
  { pattern: /\*(\d+(?:\.\d+)?)\s*L\b/, kind: "volume_l", toBase: toLiters.l },
];

const LOOSE_PACK_RULES: PackRule[] = [
  { pattern: /\b(\d+(?:\.\d+)?)\s*MG\b/, kind: "mass_kg", toBase: toKg.mg },
  { pattern: /\b(\d+(?:\.\d+)?)\s*GR(?:AMOS?)?\b/, kind: "mass_kg", toBase: toKg.gr },
  { pattern: /\b(\d+(?:\.\d+)?)\s*G\b/, kind: "mass_kg", toBase: toKg.g },
  { pattern: /\b(\d+(?:\.\d+)?)\s*KG\b/, kind: "mass_kg", toBase: toKg.kg },
  { pattern: /\b(\d+(?:\.\d+)?)\s*ML\b/, kind: "volume_l", toBase: toLiters.ml },
  { pattern: /\b(\d+(?:\.\d+)?)\s*CC\b/, kind: "volume_l", toBase: toLiters.cc },
  { pattern: /\b(\d+(?:\.\d+)?)\s*CL\b/, kind: "volume_l", toBase: toLiters.cl },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:LT|LITROS?)\b/, kind: "volume_l", toBase: toLiters.lt },
  { pattern: /\b(\d+(?:\.\d+)?)\s*L\b/, kind: "volume_l", toBase: toLiters.l },
];

const UM_NUMERIC_RULES: PackRule[] = [
  { pattern: /^(\d+(?:\.\d+)?)\s*MG$/, kind: "mass_kg", toBase: toKg.mg },
  { pattern: /^(\d+(?:\.\d+)?)\s*GR(?:AMOS?)?$/, kind: "mass_kg", toBase: toKg.gr },
  { pattern: /^(\d+(?:\.\d+)?)\s*G$/, kind: "mass_kg", toBase: toKg.g },
  { pattern: /^(\d+(?:\.\d+)?)\s*KG$/, kind: "mass_kg", toBase: toKg.kg },
  { pattern: /^(\d+(?:\.\d+)?)\s*ML$/, kind: "volume_l", toBase: toLiters.ml },
  { pattern: /^(\d+(?:\.\d+)?)\s*CC$/, kind: "volume_l", toBase: toLiters.cc },
  { pattern: /^(\d+(?:\.\d+)?)\s*CL$/, kind: "volume_l", toBase: toLiters.cl },
  { pattern: /^(\d+(?:\.\d+)?)\s*(?:LT|LITROS?)$/, kind: "volume_l", toBase: toLiters.lt },
];

const matchPackRules = (
  text: string,
  um: string,
  rules: PackRule[],
  source: "text" | "um",
): ResolvedItemUom | null => {
  const haystack = source === "text" ? text : um;
  for (const rule of rules) {
    const match = rule.pattern.exec(haystack);
    if (!match) continue;
    const factor = rule.toBase(parsePackNumber(match[1]!));
    if (factor > 0) return { kind: rule.kind, factor };
  }
  return null;
};

/**
 * Clasifica un ítem: gramos/mg → factor en kilos; ml/cc/cl → factor en litros.
 * Empaque (*250g, *900ml): cantidad BD = empaques. *KILO / id KILO: cantidad ya en kg.
 */
export const resolveItemUom = (
  itemLabel: string,
  unitId = "",
): ResolvedItemUom => {
  const text = normalizeUomText(`${itemLabel} ${unitId}`);
  const um = (unitId ?? "").trim().toUpperCase();

  if (isExplicitCountItem(text)) {
    return { kind: "count", factor: 1 };
  }

  if (/\*(KILO|KG)\b/.test(text) || /\bA\s+KILO\b/.test(text) || /\bPOR\s+KILO\b/.test(text)) {
    return { kind: "mass_kg", factor: 1 };
  }

  if (/\*(LITRO|LITROS|LT)\b/.test(text)) {
    return { kind: "volume_l", factor: 1 };
  }

  const starMatch = matchPackRules(text, um, STAR_PACK_RULES, "text");
  if (starMatch) return starMatch;

  const umNumeric = matchPackRules(text, um, UM_NUMERIC_RULES, "um");
  if (umNumeric) return umNumeric;

  if (/\b(KILO|KILOS|KG|KGM)\b/.test(um)) {
    return { kind: "mass_kg", factor: 1 };
  }

  if (/\b(LITRO|LITROS|LT|LTR|LTS|ML|MILILITRO|MILILITROS|CC|CL)\b/.test(um)) {
    return { kind: "volume_l", factor: 1 };
  }

  if (/\b(MG|MILIGRAMO|MILIGRAMOS|GR|GRM|GRAMO|GRAMOS)\b/.test(um)) {
    return { kind: "mass_kg", factor: 1 };
  }

  const looseMatch = matchPackRules(text, um, LOOSE_PACK_RULES, "text");
  if (looseMatch) return looseMatch;

  if (COUNT_UNIT_IDS.test(um)) {
    if (/\bKILO\b/.test(text)) return { kind: "mass_kg", factor: 1 };
    if (/\b(LITRO|LITROS)\b/.test(text)) return { kind: "volume_l", factor: 1 };
    return { kind: "count", factor: 1 };
  }

  if (/\bKILO\b/.test(text)) return { kind: "mass_kg", factor: 1 };
  if (/\b(LITRO|LITROS)\b/.test(text)) return { kind: "volume_l", factor: 1 };

  return { kind: "count", factor: 1 };
};

export const displayLabelForItemUomKind = (
  kind: ItemUomKind,
): string | null => {
  if (kind === "count") return null;
  return DISPLAY_LABEL[kind];
};

/**
 * Revisa todos los ítems de una sublínea/línea.
 * Gramos/mg/kg → kilos; ml/cc/cl/lt → litros. *und bloquea la conversión.
 */
export const resolveGroupDisplayUom = (
  itemIndices: readonly number[],
  ctx: { items: string[]; ums: string[] },
): string | null => {
  if (itemIndices.length === 0) return null;

  let massItems = 0;
  let volumeItems = 0;

  for (const index of itemIndices) {
    const itemLabel = ctx.items[index] ?? "";
    const unitId = ctx.ums?.[index] ?? "";
    const text = normalizeUomText(itemLabel);

    if (isExplicitCountItem(text)) return null;

    const resolved = resolveItemUom(itemLabel, unitId);
    if (resolved.kind === "count") continue;

    if (resolved.kind === "mass_kg") massItems += 1;
    if (resolved.kind === "volume_l") volumeItems += 1;
  }

  if (massItems > 0 && volumeItems > 0) return null;
  if (massItems > 0) return "kilos";
  if (volumeItems > 0) return "litros";
  return null;
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
  sublineItems: ReadonlyMap<string, readonly number[]>;
  lineItems: ReadonlyMap<number, readonly number[]>;
};

const mergeItemIndices = (
  map: Map<string, Set<number>>,
  key: string,
  itemIndices: readonly number[],
) => {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = new Set<number>();
    map.set(key, bucket);
  }
  for (const index of itemIndices) bucket.add(index);
};

/** Agrupa ítems por sublínea/línea y calcula kilos o litros para cada grupo. */
export const buildInformeLineUomIndex = (
  rowIndex: InformeRowIndex,
  ctx: { items: string[]; ums?: string[] },
): InformeLineUomIndex => {
  const safeCtx = { items: ctx.items, ums: ctx.ums ?? [] };
  const lineDisplayUom = new Map<number, string>();
  const sublineDisplayUom = new Map<string, string>();
  const sublineItemsMap = new Map<string, Set<number>>();
  const lineItemsMap = new Map<number, Set<number>>();

  for (const [catLinSub, itemIndices] of rowIndex.itemsByCatLinSub) {
    const parts = catLinSub.split("|");
    if (parts.length !== 3) continue;
    const lin = Number(parts[1]);
    const sub = Number(parts[2]);
    if (!Number.isFinite(lin) || !Number.isFinite(sub)) continue;

    const subKey = `${lin}|${sub}`;
    mergeItemIndices(sublineItemsMap, subKey, itemIndices);

    let lineBucket = lineItemsMap.get(lin);
    if (!lineBucket) {
      lineBucket = new Set<number>();
      lineItemsMap.set(lin, lineBucket);
    }
    for (const itemIndex of itemIndices) lineBucket.add(itemIndex);
  }

  for (const [subKey, itemSet] of sublineItemsMap) {
    const itemIndices = [...itemSet];
    const label = resolveGroupDisplayUom(itemIndices, safeCtx);
    if (label) sublineDisplayUom.set(subKey, label);
  }

  for (const [lin, itemSet] of lineItemsMap) {
    const itemIndices = [...itemSet];
    const label = resolveGroupDisplayUom(itemIndices, safeCtx);
    if (label) lineDisplayUom.set(lin, label);
  }

  return {
    lineDisplayUom,
    sublineDisplayUom,
    sublineItems: new Map(
      [...sublineItemsMap.entries()].map(([key, set]) => [key, [...set] as readonly number[]]),
    ),
    lineItems: new Map(
      [...lineItemsMap.entries()].map(([key, set]) => [key, [...set] as readonly number[]]),
    ),
  };
};

export const resolveSublineDisplayUom = (
  ctx: {
    items: string[];
    ums: string[];
    sublineDisplayUom: ReadonlyMap<string, string>;
    sublineItems: ReadonlyMap<string, readonly number[]>;
  },
  lin: number,
  sub: number,
): string | null => {
  const key = `${lin}|${sub}`;
  const cached = ctx.sublineDisplayUom.get(key);
  if (cached) return cached;

  const itemIndices = ctx.sublineItems.get(key);
  if (!itemIndices?.length) return null;
  return resolveGroupDisplayUom(itemIndices, ctx);
};

export const resolveLineDisplayUom = (
  ctx: {
    items: string[];
    ums: string[];
    lineDisplayUom: ReadonlyMap<number, string>;
    lineItems: ReadonlyMap<number, readonly number[]>;
  },
  lin: number,
): string | null => {
  const cached = ctx.lineDisplayUom.get(lin);
  if (cached) return cached;

  const itemIndices = ctx.lineItems.get(lin);
  if (!itemIndices?.length) return null;
  return resolveGroupDisplayUom(itemIndices, ctx);
};
