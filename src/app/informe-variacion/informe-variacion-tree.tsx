"use client";

import {
  aggregateByKey,
  type PeriodTriple,
} from "@/lib/informe-variacion/aggregate";
import { formatInformeValue } from "@/lib/informe-variacion/format";
import type { InformeMetric } from "@/lib/informe-variacion/types";
import { INFORME_EMPRESA_ORDER } from "@/lib/informe-variacion/types";
import { cn } from "@/lib/shared/utils";
import type { prepareInformeData } from "@/lib/informe-variacion/aggregate";
import { VariationChip } from "@/app/informe-variacion/informe-variacion-chips";

type Prepared = ReturnType<typeof prepareInformeData>;

const cmpVal = (values: PeriodTriple, col: string): number => {
  switch (col) {
    case "cur":
    case "part":
      return values[0];
    case "yoy":
      return values[2];
    case "mom":
      return values[1];
    case "yoypct":
      return values[2] > 0 ? values[0] / values[2] - 1 : values[0] > 0 ? Infinity : -Infinity;
    case "mompct":
      return values[1] > 0 ? values[0] / values[1] - 1 : values[0] > 0 ? Infinity : -Infinity;
    default:
      return 0;
  }
};

const sortedEntries = (
  map: Map<number, PeriodTriple>,
  labels: string[] | undefined,
  sort: { col: string; dir: number },
) => {
  const entries = [...map.entries()];
  if (sort.col === "name") {
    entries.sort((a, b) =>
      labels
        ? labels[a[0]].localeCompare(labels[b[0]], "es")
        : a[0] - b[0],
    );
    if (sort.dir < 0) entries.reverse();
    return entries;
  }
  entries.sort((a, b) => (cmpVal(b[1], sort.col) - cmpVal(a[1], sort.col)) * sort.dir);
  return entries;
};

export function TreeTable({
  payload,
  metric,
  pass,
  treeOpen,
  setTreeOpen,
  treeShown,
  setTreeShown,
  sort,
  onSort,
  curLabel,
  momLabel,
  yoyLabel,
}: {
  payload: Prepared;
  metric: InformeMetric;
  pass: (row: Prepared["rows"][number]) => boolean;
  treeOpen: Set<string>;
  setTreeOpen: React.Dispatch<React.SetStateAction<Set<string>>>;
  treeShown: Record<string, number>;
  setTreeShown: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  sort: { col: string; dir: number };
  onSort: (col: string) => void;
  curLabel: string;
  momLabel: string;
  yoyLabel: string;
}) {
  const filtered = payload.rows.filter(pass);
  const total = filtered.reduce((sum, row) => sum + row[metric === "u" ? 5 : 8], 0);

  const arrow = (col: string) => (sort.col === col ? (sort.dir > 0 ? " ▼" : " ▲") : "");

  const rows: React.ReactNode[] = [];

  const treeRow = (
    depth: number,
    label: React.ReactNode,
    values: PeriodTriple,
    yoyOk: boolean,
    expKey: string | null,
    canExpand: boolean,
    extra?: React.ReactNode,
  ) => {
    const part = total > 0 ? (values[0] / total) * 100 : 0;
    return (
      <tr key={expKey ?? String(label)}>
        <td
          className={cn("max-w-xl truncate px-2 py-1", depth === 0 && "font-bold")}
          style={{ paddingLeft: 6 + depth * 20 }}
          onClick={
            canExpand && expKey
              ? () =>
                  setTreeOpen((current) => {
                    const next = new Set(current);
                    if (next.has(expKey)) next.delete(expKey);
                    else next.add(expKey);
                    return next;
                  })
              : undefined
          }
        >
          {canExpand ? (
            <span className={cn("mr-1 text-slate-400", expKey && treeOpen.has(expKey) && "inline-block rotate-90")}>
              ▶
            </span>
          ) : (
            <span className="mr-1 inline-block w-3" />
          )}
          {label}
          {extra}
        </td>
        <td className="px-2 py-1 text-right font-semibold">{formatInformeValue(values[0], metric)}</td>
        <td className="px-2 py-1 text-right">
          {yoyOk ? formatInformeValue(values[2], metric) : "N/D"}
        </td>
        <td className="px-2 py-1 text-right">
          <VariationChip current={values[0]} previous={values[2]} yoyOk={yoyOk} />
        </td>
        <td className="px-2 py-1 text-right">{formatInformeValue(values[1], metric)}</td>
        <td className="px-2 py-1 text-right">
          <VariationChip current={values[0]} previous={values[1]} />
        </td>
        <td className="px-2 py-1 text-right text-slate-500">{part.toFixed(1)}%</td>
      </tr>
    );
  };

  const eAgg = new Map<string, PeriodTriple>();
  const offset = metric === "u" ? 5 : 8;
  for (const row of filtered) {
    const key = payload.sedeEmpresas[row[0]];
    const current = eAgg.get(key) ?? [0, 0, 0];
    current[0] += row[offset];
    current[1] += row[offset + 1];
    current[2] += row[offset + 2];
    eAgg.set(key, current);
  }
  for (const empresa of INFORME_EMPRESA_ORDER) {
    const empresaRows = filtered.filter((row) => payload.sedeEmpresas[row[0]] === empresa.label);
    if (empresaRows.length === 0) continue;
    const ek = `e:${empresa.label}`;
    const summed = eAgg.get(empresa.label) ?? [0, 0, 0];
    rows.push(
      treeRow(
        0,
        <span className="inline-flex items-center gap-2">{empresa.label}</span>,
        summed,
        payload.empYoy[empresa.label] ?? false,
        ek,
        true,
      ),
    );
    if (!treeOpen.has(ek)) continue;

    const sAgg = aggregateByKey(empresaRows, metric, 0, () => true);
    for (const [sedeIndex, sValues] of sortedEntries(sAgg, undefined, sort)) {
      const sk = `${ek}|s:${sedeIndex}`;
      rows.push(
        treeRow(1, payload.sedes[sedeIndex]?.s ?? String(sedeIndex), sValues, payload.sedeYoy[sedeIndex], sk, true),
      );
      if (!treeOpen.has(sk)) continue;

      const sedeRows = empresaRows.filter((row) => row[0] === sedeIndex);
      const cAgg = aggregateByKey(sedeRows, metric, 1, () => true);
      for (const [catIndex, cValues] of sortedEntries(cAgg, payload.cats, sort)) {
        const ck = `${sk}|c:${catIndex}`;
        rows.push(treeRow(2, payload.cats[catIndex], cValues, payload.sedeYoy[sedeIndex], ck, true));
        if (!treeOpen.has(ck)) continue;

        const catRows = sedeRows.filter((row) => row[1] === catIndex);
        const lAgg = aggregateByKey(catRows, metric, 2, () => true);
        for (const [linIndex, lValues] of sortedEntries(lAgg, payload.lins, sort)) {
          const lk = `${ck}|l:${linIndex}`;
          rows.push(treeRow(3, payload.lins[linIndex], lValues, payload.sedeYoy[sedeIndex], lk, true));
          if (!treeOpen.has(lk)) continue;

          const linRows = catRows.filter((row) => row[2] === linIndex);
          const bAgg = aggregateByKey(linRows, metric, 3, () => true);
          for (const [subIndex, bValues] of sortedEntries(bAgg, payload.subs, sort)) {
            const bk = `${lk}|b:${subIndex}`;
            rows.push(treeRow(4, payload.subs[subIndex], bValues, payload.sedeYoy[sedeIndex], bk, true));
            if (!treeOpen.has(bk)) continue;

            const subRows = linRows.filter((row) => row[3] === subIndex);
            const iAgg = aggregateByKey(subRows, metric, 4, () => true);
            const entries = sortedEntries(iAgg, payload.items, sort);
            const limit = treeShown[bk] ?? 50;
            for (const [itemIndex, iValues] of entries.slice(0, limit)) {
              const um =
                metric === "u" ? (
                  <span className="ml-2 text-xs text-slate-400">{payload.ums[itemIndex]}</span>
                ) : null;
              rows.push(
                treeRow(
                  5,
                  payload.items[itemIndex],
                  iValues,
                  payload.sedeYoy[sedeIndex],
                  null,
                  false,
                  um,
                ),
              );
            }
            if (entries.length > limit) {
              rows.push(
                <tr key={`${bk}-more`}>
                  <td colSpan={7} className="px-2 py-1" style={{ paddingLeft: 6 + 5 * 20 }}>
                    <button
                      type="button"
                      className="text-xs font-semibold text-blue-600"
                      onClick={() =>
                        setTreeShown((current) => ({
                          ...current,
                          [bk]: (current[bk] ?? 50) + 100,
                        }))
                      }
                    >
                      Mostrar {Math.min(100, entries.length - limit)} mas de{" "}
                      {entries.length - limit} items...
                    </button>
                  </td>
                </tr>,
              );
            }
          }
        }
      }
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            {[
              ["name", "Nivel"],
              ["cur", curLabel],
              ["yoy", yoyLabel],
              ["yoypct", "YoY %"],
              ["mom", momLabel],
              ["mompct", "MoM %"],
              ["part", "Part. %"],
            ].map(([col, label]) => (
              <th
                key={col}
                className="cursor-pointer border-b-2 border-slate-200 px-2 py-2 text-left"
                onClick={() => onSort(col)}
              >
                {label}
                {arrow(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}
