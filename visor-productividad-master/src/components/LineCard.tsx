import { formatCOP, formatHours, hasLaborDataForLine } from "@/lib/calc";
import { LineMetrics } from "@/types";

interface LineCardProps {
  line: LineMetrics;
  hasData?: boolean;
}

const getLineAccentClass = (lineId: string) => {
  const accents: Record<string, string> = {
    cajas: "bg-blue-500",
    fruver: "bg-emerald-500",
    carnes: "bg-rose-500",
    industria: "bg-amber-500",
    "pollo y pescado": "bg-cyan-500",
    asadero: "bg-violet-500",
  };
  return accents[lineId] ?? "bg-slate-500";
};

// Componente extraído para mejor legibilidad
const MetricRow = ({
  label,
  value,
  icon,
  valueClassName = "text-slate-900",
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  valueClassName?: string;
}) => (
  <div className="flex items-center justify-between">
    <span className="flex items-center gap-2 text-slate-700">
      {icon}
      {label}
    </span>
    <span className={`text-base font-semibold ${valueClassName}`}>{value}</span>
  </div>
);

export const LineCard = ({ line, hasData = true }: LineCardProps) => {
  const hasLaborData = hasLaborDataForLine(line.id);
  const displayHours = hasLaborData ? line.hours : 0;
  const salesPerHour =
    hasData && displayHours > 0
      ? line.sales / 1_000_000 / displayHours
      : null;
  const emptyLabel = "—";
  const zeroHours = "0h";

  return (
    <article
      data-animate="line-card"
      className="flex flex-col gap-4 rounded-3xl border border-slate-200/80 bg-linear-to-br from-white via-slate-50 to-slate-50/60 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)] transition-all duration-200 hover:border-slate-300 hover:shadow-[0_20px_70px_-35px_rgba(15,23,42,0.2)]"
    >
      {/* Header */}
      <header>
        <span
          className={`mb-3 block h-1.5 w-14 rounded-full ${getLineAccentClass(line.id)}`}
        />
        <p className="text-sm uppercase tracking-[0.2em] text-slate-800">
          Línea
        </p>
        <h2 className="text-xl font-semibold text-slate-900">{line.name}</h2>
      </header>

      {/* Metrics */}
      <div className="grid gap-3 text-sm">
        <MetricRow
          label="Ventas"
          value={hasData ? formatCOP(line.sales) : emptyLabel}
          valueClassName={hasData ? "text-slate-900" : "text-slate-600"}
        />
        <MetricRow
          label="Horas trabajadas"
          value={hasData ? `${formatHours(displayHours)}h` : zeroHours}
          valueClassName={hasData ? "text-slate-900" : "text-slate-600"}
        />
        <MetricRow
          label="Vta/hr"
          value={salesPerHour === null ? emptyLabel : salesPerHour.toFixed(3)}
          valueClassName={hasData ? "text-slate-900" : "text-slate-600"}
        />
      </div>
    </article>
  );
};


