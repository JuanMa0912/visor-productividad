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

/** ¿La descripción o id_unidad mencionan ml/kg/lt/gr/cl/cc/kilo? */
export const itemHasMeasurableUomMarker = (
  itemLabel: string,
  unitId = "",
): boolean => {
  const text = normalizeUomText(`${itemLabel} ${unitId}`);
  if (isExplicitCountItem(text)) return false;
  if (resolveItemUom(itemLabel, unitId).kind !== "count") return true;
  return false;
};

const starPackFactor = (
  text: string,
  pattern: RegExp,
  toBase: (n: number) => number,
): number | null => {
  const match = pattern.exec(text);
  if (!match) return null;
  const n = parsePackNumber(match[1]!);
  return n > 0 ? toBase(n) : null;
};

const loosePackFactor = (
  text: string,
  pattern: RegExp,
  toBase: (n: number) => number,
): number | null => {
  const match = pattern.exec(text);
  if (!match) return null;
  const n = parsePackNumber(match[1]!);
  return n > 0 ? toBase(n) : null;
};

const umNumericFactor = (
  um: string,
  pattern: RegExp,
  toBase: (n: number) => number,
): number | null => {
  const match = pattern.exec(um);
  if (!match) return null;
  const n = parsePackNumber(match[1]!);
  return n > 0 ? toBase(n) : null;
};

/**
 * Clasifica la unidad de un ítem revisando descripción e id_unidad.
 * Soporta: *KILO, *900ml, *500gr, *250g, *750cc, *25cl, *1lt, id_unidad KILO/ML/LT…
 * Empaque (*900ml): cantidad BD = número de empaques → se multiplica.
 * Venta a peso/volumen (*KILO, id_unidad KILO): cantidad BD ya está en kilos/litros.
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

  // --- Venta directa a kilo / litro (cantidad ya en unidad base) ---
  if (/\*(KILO|KG)\b/.test(text) || /\bA\s+KILO\b/.test(text) || /\bPOR\s+KILO\b/.test(text)) {
    return { kind: "mass_kg", factor: 1 };
  }

  if (/\*(LITRO|LITROS|LT)\b/.test(text)) {
    return { kind: "volume_l", factor: 1 };
  }

  // --- Empaques con asterisco ---
  const starRules: Array<[RegExp, ItemUomKind, (n: number) => number]> = [
    [/\*(\d+(?:\.\d+)?)\s*GR(?:AMOS?)?\b/, "mass_kg", (n) => n / 1000],
    [/\*(\d+(?:\.\d+)?)\s*G\b/, "mass_kg", (n) => n / 1000],
    [/\*(\d+(?:\.\d+)?)\s*KG\b/, "mass_kg", (n) => n],
    [/\*(\d+(?:\.\d+)?)\s*ML\b/, "volume_l", (n) => n / 1000],
    [/\*(\d+(?:\.\d+)?)\s*CC\b/, "volume_l", (n) => n / 1000],
    [/\*(\d+(?:\.\d+)?)\s*CL\b/, "volume_l", (n) => n / 100],
    [/\*(\d+(?:\.\d+)?)\s*(?:LT|LITROS?)\b/, "volume_l", (n) => n],
    [/\*(\d+(?:\.\d+)?)\s*L\b/, "volume_l", (n) => n],
  ];

  for (const [pattern, kind, toBase] of starRules) {
    const factor = starPackFactor(text, pattern, toBase);
    if (factor !== null) return { kind, factor };
  }

  // --- id_unidad con cifra (900 ML, 500 GR) ---
  const umRules: Array<[RegExp, ItemUomKind, (n: number) => number]> = [
    [/^(\d+(?:\.\d+)?)\s*GR(?:AMOS?)?$/, "mass_kg", (n) => n / 1000],
    [/^(\d+(?:\.\d+)?)\s*G$/, "mass_kg", (n) => n / 1000],
    [/^(\d+(?:\.\d+)?)\s*KG$/, "mass_kg", (n) => n],
    [/^(\d+(?:\.\d+)?)\s*ML$/, "volume_l", (n) => n / 1000],
    [/^(\d+(?:\.\d+)?)\s*CC$/, "volume_l", (n) => n / 1000],
    [/^(\d+(?:\.\d+)?)\s*CL$/, "volume_l", (n) => n / 100],
    [/^(\d+(?:\.\d+)?)\s*(?:LT|LITROS?)$/, "volume_l", (n) => n],
  ];

  for (const [pattern, kind, toBase] of umRules) {
    const factor = umNumericFactor(um, pattern, toBase);
    if (factor !== null) return { kind, factor };
  }

  // --- id_unidad genérico ---
  if (/\b(KILO|KILOS|KG|KGM)\b/.test(um)) {
    return { kind: "mass_kg", factor: 1 };
  }

  if (/\b(LITRO|LITROS|LT|LTR|LTS|ML|MILILITRO|MILILITROS|CC|CL)\b/.test(um)) {
    return { kind: "volume_l", factor: 1 };
  }

  if (/\b(GR|GRM|GRAMO|GRAMOS)\b/.test(um)) {
    return { kind: "mass_kg", factor: 1 };
  }

  // --- Marcas sueltas en descripción (sin asterisco) ---
  const looseRules: Array<[RegExp, ItemUomKind, (n: number) => number]> = [
    [/\b(\d+(?:\.\d+)?)\s*GR(?:AMOS?)?\b/, "mass_kg", (n) => n / 1000],
    [/\b(\d+(?:\.\d+)?)\s*G\b/, "mass_kg", (n) => n / 1000],
    [/\b(\d+(?:\.\d+)?)\s*KG\b/, "mass_kg", (n) => n],
    [/\b(\d+(?:\.\d+)?)\s*ML\b/, "volume_l", (n) => n / 1000],
    [/\b(\d+(?:\.\d+)?)\s*CC\b/, "volume_l", (n) => n / 1000],
    [/\b(\d+(?:\.\d+)?)\s*CL\b/, "volume_l", (n) => n / 100],
    [/\b(\d+(?:\.\d+)?)\s*(?:LT|LITROS?)\b/, "volume_l", (n) => n],
    [/\b(\d+(?:\.\d+)?)\s*L\b/, "volume_l", (n) => n],
  ];

  for (const [pattern, kind, toBase] of looseRules) {
    const factor = loosePackFactor(text, pattern, toBase);
    if (factor !== null) return { kind, factor };
  }

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
 * Analiza todos los ítems de un grupo (sublínea o línea):
 * - Si alguno es *und → no convierte.
 * - Si todos los medibles comparten kilos o litros → devuelve esa etiqueta.
 * - Ítems sin marca de peso/volumen se ignoran al clasificar el grupo.
 */
export const resolveGroupDisplayUom = (
  itemIndices: readonly number[],
  ctx: { items: string[]; ums: string[] },
): string | null => {
  if (itemIndices.length === 0) return null;

  let dominantKind: Exclude<ItemUomKind, "count"> | null = null;
  let measurableItems = 0;

  for (const index of itemIndices) {
    const itemLabel = ctx.items[index] ?? "";
    const unitId = ctx.ums[index] ?? "";
    const text = normalizeUomText(itemLabel);

    if (isExplicitCountItem(text)) return null;

    const resolved = resolveItemUom(itemLabel, unitId);

    if (resolved.kind === "count") {
      if (itemHasMeasurableUomMarker(itemLabel, unitId)) return null;
      continue;
    }

    measurableItems += 1;
    if (dominantKind === null) {
      dominantKind = resolved.kind;
    } else if (dominantKind !== resolved.kind) {
      return null;
    }
  }

  if (measurableItems === 0 || !dominantKind) return null;
  return displayLabelForItemUomKind(dominantKind);
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

/** Precalcula unidad de display por sublínea y línea revisando todos sus ítems. */
export const buildInformeLineUomIndex = (
  rowIndex: InformeRowIndex,
  ctx: { items: string[]; ums: string[]; subs?: string[]; lins?: string[] },
): InformeLineUomIndex => {
  void ctx.subs;
  void ctx.lins;

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
