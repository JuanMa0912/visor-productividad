"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * Vista "Editorial pareada" del Top de cajeros: dos columnas (mes anterior y
 * mes en curso) con tarjetas minimalistas tipo "ranking", mas una linea
 * curva que conecta a los cajeros que aparecen en ambos periodos.
 *
 * Componente presentacional puro: recibe los datos por props, no inventa
 * valores ni hace fetch. La logica de coincidencias y movimientos se
 * deriva localmente comparando `prev.cashiers` y `curr.cashiers`.
 *
 * Reglas de estilo (alineadas con tokens de `globals.css`):
 * - Colores semanticos: `text-accent-up` (verde), `text-accent-down` (rojo),
 *   `text-accent-stable` (azul). Nada de `text-green-500` / `text-red-500`.
 * - Tipografias: `font-display` para nombres y cifras, `font-mono` para
 *   etiquetas, IDs y badges, `font-sans` por defecto.
 */

export type EditorialTop5Cashier = {
  rank: number;
  personKey: string;
  name: string;
  id: string | null;
  value: number;
};

export type EditorialTop5Period = {
  label: string;
  range: string;
  avg: number;
  cashiers: EditorialTop5Cashier[];
};

export type EditorialTop5Props = {
  prev: EditorialTop5Period;
  curr: EditorialTop5Period;
  topSize?: number;
  /** Permite ocultar la curva entre cajeros emparejados. */
  showConnectingLine?: boolean;
};

const formatVtaHr = (value: number) =>
  value.toLocaleString("es-CO", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });

const formatDeltaPct = (delta: number) =>
  `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;

type Shift =
  | { kind: "up"; positions: number }
  | { kind: "down"; positions: number }
  | { kind: "stable" }
  | { kind: "out" }
  | { kind: "in" };

const describeShiftPrev = (
  prev: EditorialTop5Cashier,
  currMatch: EditorialTop5Cashier | undefined,
): Shift => {
  if (!currMatch) return { kind: "out" };
  const diff = prev.rank - currMatch.rank;
  if (diff === 0) return { kind: "stable" };
  return diff > 0
    ? { kind: "up", positions: diff }
    : { kind: "down", positions: -diff };
};

const describeShiftCurr = (
  curr: EditorialTop5Cashier,
  prevMatch: EditorialTop5Cashier | undefined,
): Shift => {
  if (!prevMatch) return { kind: "in" };
  const diff = prevMatch.rank - curr.rank;
  if (diff === 0) return { kind: "stable" };
  return diff > 0
    ? { kind: "up", positions: diff }
    : { kind: "down", positions: -diff };
};

const shiftBadgeText = (shift: Shift, counterpartRank: number | null) => {
  switch (shift.kind) {
    case "out":
      return "SALE DEL TOP";
    case "in":
      return "ENTRO AL TOP";
    case "stable":
      return counterpartRank ? `MANTIENE → #${counterpartRank}` : "MANTIENE";
    case "up":
      return `SUBE ${shift.positions} POS.`;
    case "down":
      return `BAJO ${shift.positions} POS.`;
  }
};

const shiftBadgeToneClass = (shift: Shift) => {
  switch (shift.kind) {
    case "up":
    case "in":
      return "text-accent-up";
    case "down":
    case "out":
      return "text-zinc-400";
    case "stable":
    default:
      return "text-accent-stable";
  }
};

const buildKey = (c: EditorialTop5Cashier) =>
  c.personKey || `${(c.id ?? "").trim()}|${c.name.trim()}`;

const findCounterpart = (
  list: EditorialTop5Cashier[],
  target: EditorialTop5Cashier,
): EditorialTop5Cashier | undefined => {
  const targetKey = buildKey(target);
  return list.find((c) => buildKey(c) === targetKey);
};

const Row = ({
  cashier,
  shift,
  side,
  counterpartRank,
  showDelta,
  prevValue,
  rowRef,
}: {
  cashier: EditorialTop5Cashier;
  shift: Shift;
  side: "prev" | "curr";
  counterpartRank: number | null;
  showDelta?: boolean;
  prevValue?: number;
  rowRef: (el: HTMLDivElement | null) => void;
}) => {
  const muted =
    side === "prev" && shift.kind === "out"
      ? "opacity-85"
      : side === "curr" && shift.kind === "in"
        ? ""
        : "";
  const isMatch = shift.kind !== "out" && shift.kind !== "in";
  const cardClasses = `relative flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${
    isMatch
      ? "border-zinc-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]"
      : "border-zinc-100 bg-zinc-50/60"
  } ${muted}`;
  const rankClasses =
    side === "prev"
      ? "text-zinc-300"
      : shift.kind === "in"
        ? "text-accent-up"
        : "text-accent-stable";
  const badgeText = shiftBadgeText(shift, counterpartRank);
  const badgeTone = shiftBadgeToneClass(shift);

  let deltaNode: React.ReactNode = null;
  if (
    showDelta &&
    typeof prevValue === "number" &&
    prevValue > 0 &&
    isMatch
  ) {
    const deltaPct = ((cashier.value - prevValue) / prevValue) * 100;
    const positive = deltaPct >= 0;
    deltaNode = (
      <span
        className={`font-mono text-[10px] font-semibold tabular-nums ${
          positive ? "text-accent-up" : "text-accent-down"
        }`}
      >
        {formatDeltaPct(deltaPct)}
      </span>
    );
  }

  return (
    <div ref={rowRef} className={cardClasses}>
      <span
        className={`font-display text-2xl font-extrabold tracking-tighter ${rankClasses}`}
      >
        {String(cashier.rank).padStart(2, "0")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-bold uppercase tracking-tight text-zinc-900">
          {cashier.name}
        </p>
        <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
          {cashier.id ? `ID ${cashier.id}` : "Sin ID"}
          <span className="mx-1 text-zinc-300">·</span>
          <span className={`font-semibold ${badgeTone}`}>{badgeText}</span>
        </p>
      </div>
      <div className="flex flex-col items-end gap-0.5 text-right">
        <span className="font-display text-xl font-extrabold tracking-tighter tabular-nums text-zinc-900">
          {formatVtaHr(cashier.value)}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-400">
          VTA/HR
        </span>
        {deltaNode}
      </div>
    </div>
  );
};

const Column = ({
  period,
  counterpart,
  side,
  registerRowRef,
  emptyMessage,
}: {
  period: EditorialTop5Period;
  counterpart: EditorialTop5Period;
  side: "prev" | "curr";
  registerRowRef: (key: string, el: HTMLDivElement | null) => void;
  emptyMessage: string;
}) => (
  <section className="flex min-w-0 flex-col">
    <header className="flex items-baseline justify-between gap-3 pb-3">
      <p
        className={`font-mono text-[11px] font-bold uppercase tracking-[0.22em] ${
          side === "prev" ? "text-zinc-500" : "text-accent-up"
        }`}
      >
        {period.label}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">
        {period.range}
      </p>
    </header>
    {period.cashiers.length === 0 ? (
      <p className="mt-2 rounded-2xl border border-dashed border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-500">
        {emptyMessage}
      </p>
    ) : (
      <div className="space-y-2">
        {period.cashiers.map((cashier) => {
          const cp = findCounterpart(counterpart.cashiers, cashier);
          const shift =
            side === "prev"
              ? describeShiftPrev(cashier, cp)
              : describeShiftCurr(cashier, cp);
          return (
            <Row
              key={`${side}-${buildKey(cashier)}`}
              cashier={cashier}
              shift={shift}
              side={side}
              counterpartRank={cp?.rank ?? null}
              showDelta={side === "curr"}
              prevValue={cp?.value}
              rowRef={(el) =>
                registerRowRef(`${side}-${buildKey(cashier)}`, el)
              }
            />
          );
        })}
      </div>
    )}
  </section>
);

type ConnectingLine = {
  prevKey: string;
  d: string;
  endX: number;
  endY: number;
};

export function EditorialTop5({
  prev,
  curr,
  showConnectingLine = true,
}: EditorialTop5Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [lines, setLines] = useState<ConnectingLine[]>([]);
  const gradientId = useId();

  const registerRowRef = useCallback(
    (key: string, el: HTMLDivElement | null) => {
      rowRefs.current.set(key, el);
    },
    [],
  );

  const recomputeLines = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    setSize({ width: containerRect.width, height: containerRect.height });
    if (!showConnectingLine) {
      setLines([]);
      return;
    }
    const next: ConnectingLine[] = [];
    for (const prevCashier of prev.cashiers) {
      const cp = findCounterpart(curr.cashiers, prevCashier);
      if (!cp) continue;
      const prevKey = `prev-${buildKey(prevCashier)}`;
      const currKey = `curr-${buildKey(cp)}`;
      const prevEl = rowRefs.current.get(prevKey);
      const currEl = rowRefs.current.get(currKey);
      if (!prevEl || !currEl) continue;
      const prevRect = prevEl.getBoundingClientRect();
      const currRect = currEl.getBoundingClientRect();
      const x1 = prevRect.right - containerRect.left;
      const y1 = prevRect.top + prevRect.height / 2 - containerRect.top;
      const x2 = currRect.left - containerRect.left;
      const y2 = currRect.top + currRect.height / 2 - containerRect.top;
      const cx1 = x1 + (x2 - x1) * 0.45;
      const cx2 = x2 - (x2 - x1) * 0.45;
      const d = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`;
      next.push({ prevKey, d, endX: x2, endY: y2 });
    }
    setLines(next);
  }, [curr.cashiers, prev.cashiers, showConnectingLine]);

  useEffect(() => {
    recomputeLines();
  }, [recomputeLines]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => recomputeLines());
    observer.observe(container);
    for (const el of rowRefs.current.values()) {
      if (el) observer.observe(el);
    }
    window.addEventListener("scroll", recomputeLines, true);
    window.addEventListener("resize", recomputeLines);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", recomputeLines, true);
      window.removeEventListener("resize", recomputeLines);
    };
  }, [recomputeLines]);

  return (
    <div
      ref={containerRef}
      className="relative font-sans text-zinc-900 antialiased"
    >
      <div className="grid items-start gap-x-8 gap-y-6 md:grid-cols-2">
        <Column
          period={prev}
          counterpart={curr}
          side="prev"
          registerRowRef={registerRowRef}
          emptyMessage="Sin datos del periodo anterior."
        />
        <Column
          period={curr}
          counterpart={prev}
          side="curr"
          registerRowRef={registerRowRef}
          emptyMessage="Sin datos del mes en curso."
        />
      </div>
      {showConnectingLine && lines.length > 0 && size.width > 0 && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0"
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          <defs>
            <linearGradient
              id={`${gradientId}-stroke`}
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop
                offset="0%"
                stopColor="var(--color-accent-down)"
                stopOpacity="0.35"
              />
              <stop
                offset="100%"
                stopColor="var(--color-accent-down)"
                stopOpacity="0.9"
              />
            </linearGradient>
          </defs>
          {lines.map((line) => (
            <g key={line.prevKey}>
              <path
                d={line.d}
                stroke={`url(#${gradientId}-stroke)`}
                strokeWidth={1.5}
                fill="none"
                strokeLinecap="round"
              />
              <circle
                cx={line.endX}
                cy={line.endY}
                r={3.5}
                fill="var(--color-accent-down)"
              />
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

export default EditorialTop5;
