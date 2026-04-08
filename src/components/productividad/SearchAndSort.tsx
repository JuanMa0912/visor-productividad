import { ArrowUpDown, Search } from "lucide-react";

export const SearchAndSort = ({
  searchQuery,
  onSearchChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderToggle,
}: {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sortBy: "sales" | "hours" | "name";
  onSortByChange: (value: "sales" | "hours" | "name") => void;
  sortOrder: "asc" | "desc";
  onSortOrderToggle: () => void;
}) => (
  <div className="rounded-3xl border border-slate-200/70 bg-white p-4 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-3 flex-1">
        <div className="relative flex-1 min-w-50">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-700" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por nombre o código..."
            className="w-full rounded-full border border-slate-200/70 bg-slate-50 py-2 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-600 transition-all focus:border-mercamio-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-mercamio-100"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-700">
          Ordenar:
        </span>
        <select
          value={sortBy}
          onChange={(e) =>
            onSortByChange(e.target.value as "sales" | "hours" | "name")
          }
          className="rounded-full border border-slate-200/70 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 transition-all hover:border-slate-300 focus:border-mercamio-300 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
        >
          <option value="sales">Ventas</option>
          <option value="hours">Horas</option>
          <option value="name">Nombre</option>
        </select>
        <button
          type="button"
          onClick={onSortOrderToggle}
          className="rounded-full border border-slate-200/70 bg-slate-50 p-2 text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-100"
          title={sortOrder === "asc" ? "Ascendente" : "Descendente"}
        >
          <ArrowUpDown
            className={`h-4 w-4 transition-transform ${sortOrder === "asc" ? "rotate-180" : ""}`}
          />
        </button>
      </div>
    </div>
  </div>
);
