import type { InformeCompactRow, InformeVariacionPayload } from "@/lib/informe-variacion/types";
import {
  normalizeScopedLineaN1,
  type UserLineCategoryScope,
} from "@/lib/shared/line-category-scope";

const tipoIdFromCatLabel = (label: string): string =>
  (label.trim().split(/\s+/)[0] ?? "").trim();

const lineaCodeFromLinLabel = (label: string): string => {
  const raw = (label.trim().split(/\s+/)[0] ?? "").trim();
  return normalizeScopedLineaN1(raw.replace(/\D/g, "") || raw);
};

const catAllowed = (
  catLabel: string,
  scope: UserLineCategoryScope,
): boolean => {
  const tipoId = tipoIdFromCatLabel(catLabel);
  if (scope.excludedMargenTipos?.includes(tipoId)) return false;
  if (scope.forcedMargenTipos?.length) {
    return scope.forcedMargenTipos.includes(tipoId);
  }
  return true;
};

const linAllowed = (
  linLabel: string,
  scope: UserLineCategoryScope,
): boolean => {
  if (!scope.forcedMargenLineas?.length) return true;
  const code = lineaCodeFromLinLabel(linLabel);
  const forced = new Set(
    scope.forcedMargenLineas.map((value) => normalizeScopedLineaN1(value)),
  );
  return forced.has(code);
};

/**
 * Recorta un payload ya armado al alcance de linea/categoria del usuario.
 * Defensa en profundidad (cache viejo, SQL incompleto, snapshot std).
 */
export const filterInformePayloadForLineScope = (
  payload: InformeVariacionPayload,
  scope: UserLineCategoryScope,
): InformeVariacionPayload => {
  if (
    !scope.locked &&
    !scope.forcedMargenTipos?.length &&
    !scope.forcedMargenLineas?.length &&
    !scope.excludedMargenTipos?.length
  ) {
    return payload;
  }

  const keepCat = payload.cats.map((label) => catAllowed(label, scope));
  const keepLin = payload.lins.map((label) => linAllowed(label, scope));

  const needsFilter =
    keepCat.some((ok) => !ok) ||
    keepLin.some((ok) => !ok) ||
    Boolean(scope.forcedMargenLineas?.length || scope.forcedMargenTipos?.length);

  if (!needsFilter) return payload;

  const catMap = new Map<number, number>();
  const linMap = new Map<number, number>();
  const subMap = new Map<number, number>();
  const itemMap = new Map<number, number>();
  const cats: string[] = [];
  const lins: string[] = [];
  const subs: string[] = [];
  const items: string[] = [];
  const ums: string[] = [];

  const mapIndex = (
    map: Map<number, number>,
    labels: string[],
    sourceLabels: string[],
    sourceIdx: number,
  ): number => {
    const hit = map.get(sourceIdx);
    if (hit !== undefined) return hit;
    const next = labels.length;
    labels.push(sourceLabels[sourceIdx] ?? "");
    map.set(sourceIdx, next);
    return next;
  };

  const rows: InformeCompactRow[] = [];
  for (const row of payload.rows) {
    const [, catIdx, linIdx, subIdx, itemIdx] = row;
    if (!keepCat[catIdx] || !keepLin[linIdx]) continue;

    const nextCat = mapIndex(catMap, cats, payload.cats, catIdx);
    const nextLin = mapIndex(linMap, lins, payload.lins, linIdx);
    const nextSub = mapIndex(subMap, subs, payload.subs, subIdx);
    const nextItem = mapIndex(itemMap, items, payload.items, itemIdx);
    if (ums[nextItem] === undefined) {
      ums[nextItem] = payload.ums[itemIdx] ?? "";
    }

    rows.push([
      row[0],
      nextCat,
      nextLin,
      nextSub,
      nextItem,
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
  }

  return {
    ...payload,
    cats,
    lins,
    subs,
    items,
    ums,
    rows,
    meta: {
      ...payload.meta,
      rowCount: rows.length,
    },
  };
};

export const informeLineScopeCacheSuffix = (
  scope: Pick<
    UserLineCategoryScope,
    | "forcedMargenTipos"
    | "forcedMargenLineas"
    | "excludedMargenTipos"
  >,
): string => {
  const parts: string[] = [];
  if (scope.forcedMargenTipos?.length) {
    parts.push(`t=${[...scope.forcedMargenTipos].sort().join(",")}`);
  }
  if (scope.forcedMargenLineas?.length) {
    parts.push(
      `l=${[...scope.forcedMargenLineas].map(normalizeScopedLineaN1).sort().join(",")}`,
    );
  }
  if (scope.excludedMargenTipos?.length) {
    parts.push(`x=${[...scope.excludedMargenTipos].sort().join(",")}`);
  }
  return parts.length ? `:scope=${parts.join(";")}` : "";
};
