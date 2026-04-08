import {
  ArrowUpDown,
  BarChart3,
  Clock,
  LayoutGrid,
  Table2,
} from "lucide-react";

export const ViewToggle = ({
  viewMode,
  onChange,
}: {
  viewMode: "cards" | "comparison" | "chart" | "trends" | "hourly" | "m2";
  onChange: (
    value: "cards" | "comparison" | "chart" | "trends" | "hourly" | "m2",
  ) => void;
}) => {
  const getModeLabel = () => {
    switch (viewMode) {
      case "cards":
        return "Tarjetas detalladas";
      case "comparison":
        return "Comparativo de líneas";
      case "chart":
        return "Top 6 líneas (gráfico)";
      case "trends":
        return "Análisis de tendencias";
      case "hourly":
        return "Análisis por hora";
      case "m2":
        return "Indicadores por m2";
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200/80 bg-linear-to-b from-white to-slate-50/70 p-4 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-slate-600">
          Vista de líneas
        </p>
        <p className="text-sm font-semibold text-slate-900">{getModeLabel()}</p>
        <p className="mt-1 text-xs text-slate-600">
          Alterna la visualización para detectar oportunidades rápidamente.
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-full border border-slate-300/70 bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => onChange("cards")}
          aria-pressed={viewMode === "cards"}
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition-all ${
            viewMode === "cards"
              ? "bg-blue-100 text-blue-800 ring-1 ring-blue-200/80 shadow-sm"
              : "text-slate-600 hover:bg-white/80 hover:text-slate-800"
          }`}
        >
          <LayoutGrid className="h-4 w-4" />
          Tarjetas
        </button>
        <button
          type="button"
          onClick={() => onChange("comparison")}
          aria-pressed={viewMode === "comparison"}
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition-all ${
            viewMode === "comparison"
              ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/80 shadow-sm"
              : "text-slate-600 hover:bg-white/80 hover:text-slate-800"
          }`}
        >
          <Table2 className="h-4 w-4" />
          Comparativo
        </button>
        <button
          type="button"
          onClick={() => onChange("chart")}
          aria-pressed={viewMode === "chart"}
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition-all ${
            viewMode === "chart"
              ? "bg-violet-100 text-violet-800 ring-1 ring-violet-200/80 shadow-sm"
              : "text-slate-600 hover:bg-white/80 hover:text-slate-800"
          }`}
        >
          <BarChart3 className="h-4 w-4" />
          Gráfico
        </button>
        <button
          type="button"
          onClick={() => onChange("trends")}
          aria-pressed={viewMode === "trends"}
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition-all ${
            viewMode === "trends"
              ? "bg-amber-100 text-amber-800 ring-1 ring-amber-200/80 shadow-sm"
              : "text-slate-600 hover:bg-white/80 hover:text-slate-800"
          }`}
        >
          <ArrowUpDown className="h-4 w-4" />
          Tendencias
        </button>
        <button
          type="button"
          onClick={() => onChange("hourly")}
          aria-pressed={viewMode === "hourly"}
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition-all ${
            viewMode === "hourly"
              ? "bg-rose-100 text-rose-800 ring-1 ring-rose-200/80 shadow-sm"
              : "text-slate-600 hover:bg-white/80 hover:text-slate-800"
          }`}
        >
          <Clock className="h-4 w-4" />
          Por hora
        </button>
      </div>
    </div>
  );
};
