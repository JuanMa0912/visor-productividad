import { listMargenSedeCatalogOptions } from "@/lib/margenes/margen-sede-catalog";
import { applyInformeMockComparisonBases } from "@/lib/informe-variacion/mock-bases";
import { mockInformeComparisonMultiplier } from "@/lib/informe-variacion/mock-bases";
import { computeInformePeriods } from "@/lib/informe-variacion/periods";
import {
  formatInformeSedeLabel,
  informeEmpresaLabel,
} from "@/lib/informe-variacion/labels";
import type {
  InformeCompactRow,
  InformeVariacionPayload,
} from "@/lib/informe-variacion/types";

const DEMO_CATS = ["3 Asaderos", "4 Mercado"];
const DEMO_LINS = ["01 POLLO ASADO", "01 FRUVER", "02 CARNES ROJAS"];
const DEMO_SUBS = ["01 BASE", "02 PREMIUM"];
const DEMO_ITEMS = [
  "1001 Item demo A",
  "1002 Item demo B",
  "1003 Item demo C",
  "1004 Item demo D",
  "1005 Item demo E",
];
const DEMO_UMS = ["KG", "UND", "KG", "UND", "KG"];

const buildSedeCatalog = (allowedSedeKeys: string[] | null) => {
  const catalog = listMargenSedeCatalogOptions();
  if (!allowedSedeKeys) return catalog;
  const allowed = new Set(allowedSedeKeys);
  return catalog.filter((option) => allowed.has(option.value));
};

/** Datos sinteticos para probar UI sin depender de MoM/YoY en BD. */
export const buildInformeDemoPayload = (
  year: number,
  month: number,
  allowedSedeKeys: string[] | null,
): InformeVariacionPayload => {
  const periods = computeInformePeriods(year, month);
  const catalog = buildSedeCatalog(allowedSedeKeys);

  const sedes = catalog.map((option) => ({
    e: informeEmpresaLabel(option.empresa),
    s: formatInformeSedeLabel(option.empresa, option.idCo, option.label),
    yoyOk: true,
    key: option.value,
  }));

  const rows: InformeCompactRow[] = [];

  sedes.forEach((_, sedeIdx) => {
    DEMO_CATS.forEach((_, catIdx) => {
      DEMO_LINS.forEach((_, linIdx) => {
        DEMO_SUBS.forEach((_, subIdx) => {
          DEMO_ITEMS.forEach((_, itemIdx) => {
            const key = [sedeIdx, catIdx, linIdx, subIdx, itemIdx] as const;
            const scale =
              (1 + sedeIdx * 0.07 + catIdx * 0.12 + linIdx * 0.05) *
              mockInformeComparisonMultiplier(key, "demo", 0.15);
            const uCur = Math.round(40 * scale + itemIdx * 8);
            const vCur = Math.round(180_000 * scale + itemIdx * 25_000);
            rows.push([
              sedeIdx,
              catIdx,
              linIdx,
              subIdx,
              itemIdx,
              uCur,
              0,
              0,
              vCur,
              0,
              0,
            ]);
          });
        });
      });
    });
  });

  const base = applyInformeMockComparisonBases({
    periods,
    sedes,
    cats: [...DEMO_CATS],
    lins: [...DEMO_LINS],
    subs: [...DEMO_SUBS],
    items: [...DEMO_ITEMS],
    ums: [...DEMO_UMS],
    rows,
    meta: {
      rowCount: rows.length,
      generatedAt: new Date().toISOString(),
      comparisonAvailable: false,
    },
  });

  return {
    ...base,
    meta: {
      ...base.meta,
      mockBases: true,
      demoData: true,
    },
  };
};
