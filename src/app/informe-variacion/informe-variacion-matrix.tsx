"use client";

import { useMemo, useState, Fragment } from "react";
import {
  filterRowIndices,
  aggregateIndicesBySede,
  type PeriodTriple,
} from "@/lib/informe-variacion/aggregate";
import {
  computeVariationPct,
  formatInformePct,
  formatInformeValue,
  heatmapCellStyle,
  matrixValueCellStyle,
  metricOffset,
} from "@/lib/informe-variacion/format";
import type { InformeMetric } from "@/lib/informe-variacion/types";
import { cn } from "@/lib/shared/utils";
import type { prepareInformeData } from "@/lib/informe-variacion/aggregate";

type Prepared = ReturnType<typeof prepareInformeData>;

type MatrixProps = {
  payload: Prepared;
  metric: InformeMetric;
  pass: (row: Prepared["rows"][number]) => boolean;
  matrixMode: "yoy" | "mom";
  matrixDisplay: "pct" | "value";
  matrixOpen: Set<string>;
  setMatrixOpen: React.Dispatch<React.SetStateAction<Set<string>>>;
  matrixSort: { col: number; dir: number };
  setMatrixSort: React.Dispatch<React.SetStateAction<{ col: number; dir: number }>>;
  matrixSortKeys: (
    keys: number[],
    agg: Map<number, PeriodTriple[]>,
    labels: string[],
  ) => number[];
};

function DetailRows({
  detailKey,
  per,
  depth,
  metric,
}: {
  detailKey: string;
  per: PeriodTriple[];
  depth: number;
  metric: InformeMetric;
}) {
  const defs: Array<[string, 0 | 1 | 2]> = [
    ["Actual", 0],
    ["YoY base", 2],
    ["MoM base", 1],
  ];
  return (
    <>
      {defs.map(([label, index]) => (
        <tr key={`${detailKey}-${label}`} className="bg-slate-100 text-xs text-slate-600">
          <td className="px-2 py-1" style={{ paddingLeft: 8 + depth * 18 + 16 }}>
            ↳ {label} ({metric === "u" ? "und" : "$ miles"})
          </td>
          {per.map((values, sedeIndex) => (
            <td key={sedeIndex} className="px-1 py-1 text-center">
              {values ? formatInformeValue(values[index], metric) : "—"}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function MatrixTable({
  payload,
  metric,
  pass,
  matrixMode,
  matrixDisplay,
  matrixOpen,
  setMatrixOpen,
  matrixSort,
  setMatrixSort,
  matrixSortKeys,
}: MatrixProps) {
  const [pinnedDetails, setPinnedDetails] = useState<Set<string>>(() => new Set());
  const [hoverDetail, setHoverDetail] = useState<string | null>(null);

  const filteredIndices = useMemo(
    () => filterRowIndices(payload.rows, pass),
    [payload.rows, pass],
  );

  const catAgg = useMemo(
    () =>
      aggregateIndicesBySede(
        payload.rows,
        filteredIndices,
        metric,
        payload.sedes.length,
        1,
      ),
    [filteredIndices, metric, payload.rows, payload.sedes.length],
  );

  const totPer = useMemo(() => {
    const offset = metricOffset(metric);
    const buckets = Array.from({ length: payload.sedes.length }, () => [0, 0, 0] as PeriodTriple);
    for (const rowIndex of filteredIndices) {
      const row = payload.rows[rowIndex]!;
      const bucket = buckets[row[0]];
      bucket[0] += row[offset];
      bucket[1] += row[offset + 1];
      bucket[2] += row[offset + 2];
    }
    return buckets;
  }, [filteredIndices, metric, payload.rows, payload.sedes.length]);

  const matrixBody = useMemo(() => {
    const matrixCells = (perSede?: PeriodTriple[]) =>
      payload.sedes.map((_, index) => {
        const values = perSede?.[index];
        if (!values) return null;
        const yoyUnavailable = matrixMode === "yoy" && !payload.sedeYoy[index];
        const base = matrixMode === "mom" ? values[1] : values[2];
        return {
          cur: values[0],
          base: yoyUnavailable ? 0 : base,
          nd: yoyUnavailable,
        };
      });

    const renderMatrixCell = (cell: { cur: number; base: number; nd: boolean } | null) => {
      if (matrixDisplay === "value") {
        if (!cell || cell.cur === 0) {
          return (
            <td className="px-1 py-1 text-center text-xs" style={matrixValueCellStyle()}>
              —
            </td>
          );
        }
        const title =
          matrixMode === "mom"
            ? `Actual: ${formatInformeValue(cell.cur, metric)} | MoM base: ${formatInformeValue(cell.base, metric)}`
            : cell.nd
              ? `Actual: ${formatInformeValue(cell.cur, metric)}`
              : `Actual: ${formatInformeValue(cell.cur, metric)} | YoY base: ${formatInformeValue(cell.base, metric)}`;
        return (
          <td
            className="px-1 py-1 text-center text-xs font-semibold tabular-nums"
            style={matrixValueCellStyle()}
            title={title}
          >
            {formatInformeValue(cell.cur, metric)}
          </td>
        );
      }

      if (!cell) {
        return (
          <td className="px-1 py-1 text-center text-xs" style={heatmapCellStyle(null, true)}>
            —
          </td>
        );
      }
      if (cell.nd) {
        return (
          <td
            className="px-1 py-1 text-center text-xs"
            style={heatmapCellStyle(null, true)}
            title="Sin base YoY"
          >
            N/D
          </td>
        );
      }
      if (cell.base === 0) {
        return (
          <td
            className="px-1 py-1 text-center text-xs"
            style={heatmapCellStyle(null, true)}
            title={`Actual: ${formatInformeValue(cell.cur, metric)}`}
          >
            {cell.cur === 0 ? "—" : "Nuevo"}
          </td>
        );
      }
      const pct = computeVariationPct(cell.cur, cell.base);
      return (
        <td
          className="px-1 py-1 text-center text-xs font-semibold"
          style={heatmapCellStyle(pct)}
          title={`Actual: ${formatInformeValue(cell.cur, metric)} | Base: ${formatInformeValue(cell.base, metric)}`}
        >
          {formatInformePct(pct)}
        </td>
      );
    };

    const rows: React.ReactNode[] = [];

    rows.push(
      <tr key="total" className="bg-slate-100 font-semibold">
        <td className="px-2 py-1">TOTAL (segun filtros)</td>
        {matrixCells(totPer).map((cell, index) => (
          <Fragment key={index}>{renderMatrixCell(cell)}</Fragment>
        ))}
      </tr>,
    );

    const catKeys = matrixSortKeys([...catAgg.keys()], catAgg, payload.cats);
    for (const cat of catKeys) {
      const ck = `c${cat}`;
      rows.push(
        <MatrixRow
          key={ck}
          label={payload.cats[cat]}
          cells={matrixCells(catAgg.get(cat))}
          depth={0}
          expandable
          open={matrixOpen.has(ck)}
          onToggle={() =>
            setMatrixOpen((current) => {
              const next = new Set(current);
              if (next.has(ck)) next.delete(ck);
              else next.add(ck);
              return next;
            })
          }
          renderCell={renderMatrixCell}
        />,
      );

      if (!matrixOpen.has(ck)) continue;

      const catIndices = filteredIndices.filter((index) => payload.rows[index]![1] === cat);
      const linAgg = aggregateIndicesBySede(
        payload.rows,
        catIndices,
        metric,
        payload.sedes.length,
        2,
      );
      const linKeys = matrixSortKeys([...linAgg.keys()], linAgg, payload.lins);
      for (const lin of linKeys) {
        const lk = `${ck}|l${lin}`;
        const linDetailKey = `lin:${lk}`;
        const linPer = linAgg.get(lin) ?? [];
        rows.push(
          <MatrixRow
            key={lk}
            label={payload.lins[lin]}
            cells={matrixCells(linPer)}
            depth={1}
            expandable
            open={matrixOpen.has(lk)}
            onToggle={() =>
              setMatrixOpen((current) => {
                const next = new Set(current);
                if (next.has(lk)) next.delete(lk);
                else next.add(lk);
                return next;
              })
            }
            onMouseEnter={() => setHoverDetail(linDetailKey)}
            onMouseLeave={() =>
              setHoverDetail((current) => (current === linDetailKey ? null : current))
            }
            renderCell={renderMatrixCell}
          />,
        );
        if (hoverDetail === linDetailKey && !pinnedDetails.has(linDetailKey)) {
          rows.push(
            <DetailRows
              key={`${linDetailKey}-detail`}
              detailKey={linDetailKey}
              per={linPer}
              depth={1}
              metric={metric}
            />,
          );
        }

        if (!matrixOpen.has(lk)) continue;

        const linIndices = catIndices.filter((index) => payload.rows[index]![2] === lin);
        const subAgg = aggregateIndicesBySede(
          payload.rows,
          linIndices,
          metric,
          payload.sedes.length,
          3,
        );
        const subKeys = matrixSortKeys([...subAgg.keys()], subAgg, payload.subs);
        for (const sub of subKeys) {
          const bk = `${lk}|b${sub}`;
          const subDetailKey = `sub:${bk}`;
          const subPer = subAgg.get(sub) ?? [];
          rows.push(
            <MatrixRow
              key={bk}
              label={payload.subs[sub]}
              cells={matrixCells(subPer)}
              depth={2}
              expandable
              open={matrixOpen.has(bk)}
              onToggle={() =>
                setMatrixOpen((current) => {
                  const next = new Set(current);
                  if (next.has(bk)) next.delete(bk);
                  else next.add(bk);
                  return next;
                })
              }
              onMouseEnter={() => setHoverDetail(subDetailKey)}
              onMouseLeave={() =>
                setHoverDetail((current) => (current === subDetailKey ? null : current))
              }
              renderCell={renderMatrixCell}
            />,
          );
          if (hoverDetail === subDetailKey && !pinnedDetails.has(subDetailKey)) {
            rows.push(
              <DetailRows
                key={`${subDetailKey}-detail`}
                detailKey={subDetailKey}
                per={subPer}
                depth={2}
                metric={metric}
              />,
            );
          }

          if (!matrixOpen.has(bk)) continue;

          const subIndices = linIndices.filter((index) => payload.rows[index]![3] === sub);
          const itAgg = aggregateIndicesBySede(
            payload.rows,
            subIndices,
            metric,
            payload.sedes.length,
            4,
          );
          const itKeys = [...itAgg.keys()]
            .sort((a, b) => {
              const sa = (itAgg.get(a) ?? []).reduce((sum, values) => sum + (values?.[0] ?? 0), 0);
              const sb = (itAgg.get(b) ?? []).reduce((sum, values) => sum + (values?.[0] ?? 0), 0);
              return sb - sa;
            })
            .slice(0, 30);
          for (const item of itKeys) {
            const itemDetailKey = `item:${bk}|i${item}`;
            const itemPer = itAgg.get(item) ?? [];
            rows.push(
              <MatrixRow
                key={`${bk}|i${item}`}
                label={<span className="text-[11px]">{payload.items[item]}</span>}
                cells={matrixCells(itemPer)}
                depth={3}
                expandable={false}
                onClick={() =>
                  setPinnedDetails((current) => {
                    const next = new Set(current);
                    if (next.has(itemDetailKey)) next.delete(itemDetailKey);
                    else next.add(itemDetailKey);
                    return next;
                  })
                }
                renderCell={renderMatrixCell}
              />,
            );
            if (pinnedDetails.has(itemDetailKey)) {
              rows.push(
                <DetailRows
                  key={`${itemDetailKey}-detail`}
                  detailKey={itemDetailKey}
                  per={itemPer}
                  depth={3}
                  metric={metric}
                />,
              );
            }
          }
        }
      }
    }

    return rows;
  }, [
    catAgg,
    filteredIndices,
    hoverDetail,
    matrixDisplay,
    matrixMode,
    matrixOpen,
    matrixSortKeys,
    metric,
    payload,
    pinnedDetails,
    setMatrixOpen,
    setPinnedDetails,
    totPer,
  ]);

  const sortArrow = (col: number) =>
    matrixSort.col === col ? (matrixSort.dir > 0 ? " ▼" : " ▲") : "";

  return (
    <div className="overflow-x-auto" onMouseLeave={() => setHoverDetail(null)}>
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th
              className="cursor-pointer border-b-2 border-slate-200 px-2 py-2 text-left"
              onClick={() =>
                setMatrixSort((current) => ({
                  col: -1,
                  dir: current.col === -1 ? current.dir * -1 : 1,
                }))
              }
            >
              Categoria / Linea / Sublinea / Item{sortArrow(-1)}
            </th>
            {payload.sedes.map((sede, index) => (
              <th
                key={sede.key}
                className="cursor-pointer border-b-2 border-slate-200 px-1 py-2 text-center"
                onClick={() =>
                  setMatrixSort((current) => ({
                    col: index,
                    dir: current.col === index ? current.dir * -1 : 1,
                  }))
                }
                title={`${sede.e} — clic para ordenar`}
              >
                {sede.s.replace(/^\d+ /, "")}
                {sortArrow(index)}
                <div className="font-normal text-slate-400">{sede.e.slice(0, 4)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{matrixBody}</tbody>
      </table>
    </div>
  );
}

function MatrixRow({
  label,
  cells,
  depth,
  expandable,
  open,
  onToggle,
  onMouseEnter,
  onMouseLeave,
  onClick,
  renderCell,
}: {
  label: React.ReactNode;
  cells: Array<{ cur: number; base: number; nd: boolean } | null>;
  depth: number;
  expandable: boolean;
  open?: boolean;
  onToggle?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
  renderCell: (cell: { cur: number; base: number; nd: boolean } | null) => React.ReactNode;
}) {
  return (
    <tr
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      className={onClick ? "cursor-pointer" : undefined}
    >
      <td
        className="max-w-xs truncate px-2 py-1"
        style={{ paddingLeft: 8 + depth * 18 }}
        onClick={expandable ? onToggle : undefined}
      >
        {expandable ? (
          <span className={cn("mr-1 inline-block text-slate-400", open && "rotate-90")}>▶</span>
        ) : (
          <span className="mr-1 inline-block w-3" />
        )}
        {label}
      </td>
      {cells.map((cell, index) => (
        <Fragment key={index}>{renderCell(cell)}</Fragment>
      ))}
    </tr>
  );
}
