"use client";

import { useMemo } from "react";
import {
  aggregateIndicesByKey,
  filterRowIndices,
  filterIndexedRowIndices,
  sumRowIndices,
  type PeriodTriple,
} from "@/lib/informe-variacion/aggregate";
import { comparePeriodTriple, formatInformeValue } from "@/lib/informe-variacion/format";
import { shouldConvertAsaderoToPollosUnd } from "@/lib/informe-variacion/asadero-pollos-und";
import { shouldConvertHuevosToUndIndividuales } from "@/lib/informe-variacion/huevos-individual-und";
import type { InformeMetric } from "@/lib/informe-variacion/types";
import { INFORME_EMPRESA_ORDER } from "@/lib/informe-variacion/types";
import { cn } from "@/lib/shared/utils";
import type { prepareInformeData } from "@/lib/informe-variacion/aggregate";
import { VariationChip } from "@/app/informe-variacion/informe-variacion-chips";

type Prepared = ReturnType<typeof prepareInformeData>;

const treeUnitSuffix = (label: string | undefined) =>
  label ? <span className="ml-2 text-xs text-slate-400">({label})</span> : null;

const resolveTreeUnitLabel = (
  payload: Prepared,
  metric: InformeMetric,
  level: "line" | "subline",
  catIndex: number,
  linIndex: number,
  subIndex?: number,
): string | undefined => {
  if (metric !== "u") return undefined;
  if (level === "subline" && subIndex !== undefined) {
    if (
      shouldConvertAsaderoToPollosUnd(
        payload.cats[catIndex] ?? "",
        payload.lins[linIndex] ?? "",
        payload.subs[subIndex] ?? "",
      )
    ) {
      return "pollos und";
    }
    if (
      shouldConvertHuevosToUndIndividuales(
        payload.lins[linIndex] ?? "",
        payload.subs[subIndex] ?? "",
      )
    ) {
      return "huevos und";
    }
    return payload.metricCtx.sublineDisplayUom.get(`${linIndex}|${subIndex}`);
  }
  return payload.metricCtx.lineDisplayUom.get(linIndex);
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
  entries.sort((a, b) => (comparePeriodTriple(b[1], sort.col) - comparePeriodTriple(a[1], sort.col)) * sort.dir);
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
  const filteredIndices = useMemo(
    () => filterRowIndices(payload.rows, pass),
    [payload.rows, pass],
  );

  const filteredSet = useMemo(() => new Set(filteredIndices), [filteredIndices]);

  const total = useMemo(
    () => sumRowIndices(payload.rows, filteredIndices, metric, payload.metricCtx)[0],
    [filteredIndices, metric, payload.metricCtx, payload.rows],
  );

  const treeBody = useMemo(() => {
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
              <span
                className={cn(
                  "mr-1 text-slate-400",
                  expKey && treeOpen.has(expKey) && "inline-block rotate-90",
                )}
              >
                ▶
              </span>
            ) : (
              <span className="mr-1 inline-block w-3" />
            )}
            {label}
            {extra}
          </td>
          <td className="px-2 py-1 text-right font-semibold">
            {formatInformeValue(values[0], metric)}
          </td>
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

    for (const empresa of INFORME_EMPRESA_ORDER) {
      const empresaIndices = filterIndexedRowIndices(
        payload.rowIndex.byEmpresa.get(empresa.label),
        filteredSet,
      );
      if (empresaIndices.length === 0) continue;

      const ek = `e:${empresa.label}`;
      const summed = sumRowIndices(payload.rows, empresaIndices, metric, payload.metricCtx);
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

      const sAgg = aggregateIndicesByKey(payload.rows, empresaIndices, metric, 0, payload.metricCtx);
      for (const [sedeIndex, sValues] of sortedEntries(sAgg, undefined, sort)) {
        const sk = `${ek}|s:${sedeIndex}`;
        rows.push(
          treeRow(
            1,
            payload.sedes[sedeIndex]?.s ?? String(sedeIndex),
            sValues,
            payload.sedeYoy[sedeIndex],
            sk,
            true,
          ),
        );
        if (!treeOpen.has(sk)) continue;

        const sedeIndices = filterIndexedRowIndices(
          payload.rowIndex.bySede.get(sedeIndex),
          filteredSet,
        );
        const cAgg = aggregateIndicesByKey(payload.rows, sedeIndices, metric, 1, payload.metricCtx);
        for (const [catIndex, cValues] of sortedEntries(cAgg, payload.cats, sort)) {
          const ck = `${sk}|c:${catIndex}`;
          rows.push(
            treeRow(2, payload.cats[catIndex], cValues, payload.sedeYoy[sedeIndex], ck, true),
          );
          if (!treeOpen.has(ck)) continue;

          const catIndices = filterIndexedRowIndices(
            payload.rowIndex.bySedeCat.get(`${sedeIndex}|${catIndex}`),
            filteredSet,
          );
          const lAgg = aggregateIndicesByKey(payload.rows, catIndices, metric, 2, payload.metricCtx);
          for (const [linIndex, lValues] of sortedEntries(lAgg, payload.lins, sort)) {
            const lk = `${ck}|l:${linIndex}`;
            rows.push(
              treeRow(
                3,
                <>
                  {payload.lins[linIndex]}
                  {treeUnitSuffix(
                    resolveTreeUnitLabel(payload, metric, "line", catIndex, linIndex),
                  )}
                </>,
                lValues,
                payload.sedeYoy[sedeIndex],
                lk,
                true,
              ),
            );
            if (!treeOpen.has(lk)) continue;

            const linIndices = filterIndexedRowIndices(
              payload.rowIndex.bySedeCatLin.get(`${sedeIndex}|${catIndex}|${linIndex}`),
              filteredSet,
            );
            const bAgg = aggregateIndicesByKey(payload.rows, linIndices, metric, 3, payload.metricCtx);
            for (const [subIndex, bValues] of sortedEntries(bAgg, payload.subs, sort)) {
              const bk = `${lk}|b:${subIndex}`;
              rows.push(
                treeRow(
                  4,
                  <>
                    {payload.subs[subIndex]}
                    {treeUnitSuffix(
                      resolveTreeUnitLabel(
                        payload,
                        metric,
                        "subline",
                        catIndex,
                        linIndex,
                        subIndex,
                      ),
                    )}
                  </>,
                  bValues,
                  payload.sedeYoy[sedeIndex],
                  bk,
                  true,
                ),
              );
              if (!treeOpen.has(bk)) continue;

              const subIndices = filterIndexedRowIndices(
                payload.rowIndex.bySedeCatLinSub.get(
                  `${sedeIndex}|${catIndex}|${linIndex}|${subIndex}`,
                ),
                filteredSet,
              );
              const iAgg = aggregateIndicesByKey(payload.rows, subIndices, metric, 4, payload.metricCtx);
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

    return rows;
  }, [
    filteredSet,
    metric,
    payload,
    setTreeOpen,
    setTreeShown,
    sort,
    total,
    treeOpen,
    treeShown,
  ]);

  const arrow = (col: string) => (sort.col === col ? (sort.dir > 0 ? " ▼" : " ▲") : "");

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
        <tbody>{treeBody}</tbody>
      </table>
    </div>
  );
}
