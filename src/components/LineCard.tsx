import { formatHours, formatLineVolume, hasLaborDataForLine } from "@/lib/shared/calc";
import { volumeKindForLine } from "@/lib/productivity/line-volume";
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

const MetricRow = ({
  label,
  value,
  valueClassName = "text-slate-900",
}: {
  label: string;
  value: string | number;
  valueClassName?: string;
}) => (
  <div className="flex items-center justify-between">
    <span className="flex items-center gap-2 text-slate-700">{label}</span>
    <span className={`text-base font-semibold ${valueClassName}`}>{value}</span>
  </div>
);

const perHour = (volume: number, hours: number): number | null =>
  hours > 0 ? volume / hours : null;

export const LineCard = ({ line, hasData = true }: LineCardProps) => {
  const hasLaborData = hasLaborDataForLine(line.id);
  const displayHours = hasLaborData ? line.hours : 0;
  const kind = volumeKindForLine(line.id);
  const emptyLabel = "—";
  const valueClass = hasData ? "text-slate-900" : "text-slate-600";
  const hoursValue = hasData ? `${formatHours(displayHours)}h` : "0h";

  const rateValue = (volume: number, digits: number) => {
    const rate = hasData ? perHour(volume, displayHours) : null;
    return rate === null ? emptyLabel : formatLineVolume(rate, digits);
  };

  let metrics: Array<{ label: string; value: string }> = [];
  if (kind === "tx") {
    const tx = line.transactions ?? line.volume ?? 0;
    metrics = [
      {
        label: "Transacciones",
        value: hasData ? formatLineVolume(tx, 0) : emptyLabel,
      },
      { label: "Horas trabajadas", value: hoursValue },
      { label: "Tx/hr", value: rateValue(tx, 2) },
    ];
  } else if (kind === "und") {
    const und = line.volume ?? 0;
    metrics = [
      {
        label: "Unidades",
        value: hasData ? formatLineVolume(und, 0) : emptyLabel,
      },
      { label: "Horas trabajadas", value: hoursValue },
      { label: "Und/hr", value: rateValue(und, 2) },
    ];
  } else if (kind === "kg") {
    const kg = line.volume ?? 0;
    metrics = [
      { label: "KG", value: hasData ? formatLineVolume(kg, 1) : emptyLabel },
      { label: "Horas trabajadas", value: hoursValue },
      { label: "KG/hr", value: rateValue(kg, 2) },
    ];
  } else if (kind === "asadero") {
    const pollosUnd = line.asaderoPollosUnd ?? 0;
    const otherUnd = line.asaderoOtherUnd ?? 0;
    const pollosHours = hasLaborData ? (line.asaderoPollosHours ?? 0) : 0;
    const otherHours = hasLaborData ? (line.asaderoOtherHours ?? 0) : 0;
    const pollosRate = hasData ? perHour(pollosUnd, pollosHours) : null;
    const otherRate = hasData ? perHour(otherUnd, otherHours) : null;
    metrics = [
      {
        label: "UND.Pollo",
        value: hasData ? formatLineVolume(pollosUnd, 2) : emptyLabel,
      },
      {
        label: "Horas UND.Pollo",
        value: hasData ? `${formatHours(pollosHours)}h` : "0h",
      },
      {
        label: "UND.Pollo/hr",
        value:
          pollosRate === null ? emptyLabel : formatLineVolume(pollosRate, 2),
      },
      {
        label: "Unidades",
        value: hasData ? formatLineVolume(otherUnd, 0) : emptyLabel,
      },
      {
        label: "Horas Unidades",
        value: hasData ? `${formatHours(otherHours)}h` : "0h",
      },
      {
        label: "Und/hr",
        value: otherRate === null ? emptyLabel : formatLineVolume(otherRate, 2),
      },
    ];
  } else {
    metrics = [{ label: "Horas trabajadas", value: hoursValue }];
  }

  return (
    <article
      data-animate="line-card"
      className="flex flex-col gap-4 rounded-3xl border border-slate-200/80 bg-linear-to-br from-white via-slate-50 to-slate-50/60 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)] transition-all duration-200 hover:border-slate-300 hover:shadow-[0_20px_70px_-35px_rgba(15,23,42,0.2)]"
    >
      <header>
        <span
          className={`mb-3 block h-1.5 w-14 rounded-full ${getLineAccentClass(line.id)}`}
        />
        <p className="text-sm uppercase tracking-[0.2em] text-slate-800">
          Línea
        </p>
        <h2 className="text-xl font-semibold text-slate-900">{line.name}</h2>
      </header>

      <div className="grid gap-3 text-sm">
        {metrics.map((metric) => (
          <MetricRow
            key={metric.label}
            label={metric.label}
            value={metric.value}
            valueClassName={valueClass}
          />
        ))}
      </div>
    </article>
  );
};
