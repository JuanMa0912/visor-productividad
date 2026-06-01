"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GanttChartSquare,
  KanbanSquare,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { useRequireAuth } from "@/lib/auth/auth-context";
import { cn } from "@/lib/shared/utils";
import type {
  CronogramaDatabase,
  CronogramaPayload,
  CronogramaTask,
  NotionPerson,
} from "@/lib/notion/cronograma";

type ApiResponse = CronogramaPayload & { error?: string; detail?: string };

type ViewMode = "kanban" | "timeline" | "list";

type FilterState = {
  query: string;
  people: string[];
  projects: string[];
  showEmptyColumns: boolean;
};

const NOTION_PILL_CLASSES: Record<string, string> = {
  default: "bg-slate-100 text-slate-700",
  gray: "bg-slate-100 text-slate-700",
  brown: "bg-amber-100 text-amber-800",
  orange: "bg-orange-100 text-orange-800",
  yellow: "bg-yellow-100 text-yellow-800",
  green: "bg-emerald-100 text-emerald-800",
  blue: "bg-sky-100 text-sky-800",
  purple: "bg-violet-100 text-violet-800",
  pink: "bg-pink-100 text-pink-800",
  red: "bg-rose-100 text-rose-800",
};

const NOTION_DOT_CLASSES: Record<string, string> = {
  default: "bg-slate-400",
  gray: "bg-slate-400",
  brown: "bg-amber-500",
  orange: "bg-orange-500",
  yellow: "bg-amber-500",
  green: "bg-emerald-500",
  blue: "bg-sky-500",
  purple: "bg-violet-500",
  pink: "bg-pink-500",
  red: "bg-rose-500",
};

const NOTION_BAR_CLASSES: Record<string, string> = {
  default: "bg-slate-300",
  gray: "bg-slate-300",
  brown: "bg-amber-400",
  orange: "bg-orange-400",
  yellow: "bg-amber-400",
  green: "bg-emerald-400",
  blue: "bg-sky-400",
  purple: "bg-violet-400",
  pink: "bg-pink-400",
  red: "bg-rose-400",
};

const NOTION_COLUMN_TINT: Record<string, string> = {
  default: "bg-white",
  gray: "bg-slate-50/80",
  brown: "bg-amber-50/70",
  orange: "bg-orange-50/70",
  yellow: "bg-amber-50/70",
  green: "bg-emerald-50/70",
  blue: "bg-sky-50/70",
  purple: "bg-violet-50/70",
  pink: "bg-pink-50/70",
  red: "bg-rose-50/70",
};

const AVATAR_PALETTE = [
  "bg-amber-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-cyan-500",
];

const STATUS_KEYWORDS = {
  inProgress: ["en curso", "en progreso", "in progress", "doing"],
  waiting: ["en espera", "por revisar", "por hacer", "pendiente", "todo"],
  blocked: ["atrasado", "perdido", "bloqueada", "bloqueado", "blocked"],
  done: ["finalizado", "terminado", "hecha", "hecho", "completado", "done", "completed"],
};

const matchesKeyword = (status: string | null, keywords: string[]) => {
  if (!status) return false;
  const normalized = status.trim().toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
};

const pillClasses = (color: string | null) =>
  NOTION_PILL_CLASSES[color ?? "default"] ?? NOTION_PILL_CLASSES.default;

const dotClasses = (color: string | null) =>
  NOTION_DOT_CLASSES[color ?? "default"] ?? NOTION_DOT_CLASSES.default;

const barClasses = (color: string | null) =>
  NOTION_BAR_CLASSES[color ?? "default"] ?? NOTION_BAR_CLASSES.default;

const columnTint = (color: string | null) =>
  NOTION_COLUMN_TINT[color ?? "default"] ?? NOTION_COLUMN_TINT.default;

const initialsFromName = (name: string | null): string => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const personPalette = (person: NotionPerson) =>
  AVATAR_PALETTE[hashString(person.id || person.name || "") % AVATAR_PALETTE.length];

const formatShortRange = (date: CronogramaTask["date"]): string | null => {
  if (!date?.start) return null;
  const formatter = new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
  });
  const startLabel = formatter.format(new Date(date.start)).replace(".", "");
  if (!date.end || date.end === date.start) return startLabel;
  const endLabel = formatter.format(new Date(date.end)).replace(".", "");
  return `${startLabel} – ${endLabel}`;
};

const formatLongDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(
    new Date(iso),
  );
};

const formatSyncStamp = (iso: string) => {
  try {
    const date = new Date(iso);
    const dateLabel = new Intl.DateTimeFormat("es-CO", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
    const timeLabel = new Intl.DateTimeFormat("es-CO", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
    return `${dateLabel} a las ${timeLabel}`;
  } catch {
    return iso;
  }
};

const startOfDay = (iso: string) => {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const taskMatchesFilters = (task: CronogramaTask, filters: FilterState) => {
  const { query, people, projects } = filters;
  if (query) {
    const haystack = [
      task.title,
      ...task.tags.map((tag) => tag.name),
      ...task.assignees.map((person) => person.name ?? ""),
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query.toLowerCase())) return false;
  }
  if (people.length > 0) {
    const matched = task.assignees.some((person) => people.includes(person.id));
    if (!matched) return false;
  }
  if (projects.length > 0) {
    const taskProjects = new Set(task.tags.map((tag) => tag.name));
    const matched = projects.some((project) => taskProjects.has(project));
    if (!matched) return false;
  }
  return true;
};

const PersonAvatar = ({
  person,
  size = "sm",
}: {
  person: NotionPerson;
  size?: "sm" | "md";
}) => {
  const [imageFailed, setImageFailed] = useState(false);
  const sizeClasses =
    size === "md" ? "h-7 w-7 text-[11px]" : "h-6 w-6 text-[10px]";

  if (person.avatarUrl && !imageFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.avatarUrl}
        alt={person.name ?? "Persona"}
        title={person.name ?? undefined}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setImageFailed(true)}
        className={cn(
          "rounded-full border-2 border-white object-cover shadow-sm",
          sizeClasses,
        )}
      />
    );
  }

  return (
    <span
      title={person.name ?? undefined}
      className={cn(
        "flex items-center justify-center rounded-full border-2 border-white font-semibold text-white shadow-sm",
        personPalette(person),
        sizeClasses,
      )}
    >
      {initialsFromName(person.name)}
    </span>
  );
};

const PeopleStack = ({
  people,
  max = 3,
}: {
  people: NotionPerson[];
  max?: number;
}) => {
  if (people.length === 0) return null;
  const visible = people.slice(0, max);
  const overflow = people.length - visible.length;
  return (
    <span className="flex -space-x-2">
      {visible.map((person) => (
        <PersonAvatar key={person.id} person={person} />
      ))}
      {overflow > 0 && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-semibold text-slate-700 shadow-sm">
          +{overflow}
        </span>
      )}
    </span>
  );
};

const TaskCard = ({ task }: { task: CronogramaTask }) => {
  const dateLabel = formatShortRange(task.date);
  return (
    <a
      href={task.url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-lg border border-slate-200/80 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:-translate-y-px hover:border-slate-300 hover:shadow-md"
    >
      <h4 className="text-sm font-semibold leading-snug text-slate-900 group-hover:text-slate-950">
        {task.title}
      </h4>
      {task.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((tag, index) => (
            <span
              key={`${tag.name}-${index}`}
              className={cn(
                "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                pillClasses(tag.color),
              )}
            >
              {tag.name}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="text-[10px] text-slate-400">
              +{task.tags.length - 3}
            </span>
          )}
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
        {dateLabel ? (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />
            {dateLabel}
          </span>
        ) : (
          <span className="text-slate-300">Sin fecha</span>
        )}
        <PeopleStack people={task.assignees} />
      </div>
    </a>
  );
};

const buildColumns = (
  database: CronogramaDatabase,
  filteredTasks: CronogramaTask[],
) => {
  const seen = new Map<
    string,
    { name: string; color: string | null; tasks: CronogramaTask[] }
  >();

  for (const option of database.statusOptions) {
    seen.set(option.name, { name: option.name, color: option.color, tasks: [] });
  }

  for (const task of filteredTasks) {
    const key = task.status.name ?? "Sin estado";
    const existing = seen.get(key);
    if (existing) {
      existing.tasks.push(task);
    } else {
      seen.set(key, { name: key, color: task.status.color, tasks: [task] });
    }
  }

  return Array.from(seen.values()).map((column) => ({
    key: column.name,
    name: column.name,
    color: column.color,
    tasks: column.tasks,
  }));
};

const KanbanView = ({
  database,
  filteredTasks,
  showEmptyColumns,
}: {
  database: CronogramaDatabase;
  filteredTasks: CronogramaTask[];
  showEmptyColumns: boolean;
}) => {
  const columns = useMemo(
    () => buildColumns(database, filteredTasks),
    [database, filteredTasks],
  );
  const visibleColumns = showEmptyColumns
    ? columns
    : columns.filter((column) => column.tasks.length > 0);

  if (visibleColumns.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        No hay tareas que coincidan con los filtros aplicados.
      </div>
    );
  }

  return (
    <div className="-mx-2 overflow-x-auto px-2 pb-3">
      <div className="flex min-w-full items-start gap-3">
        {visibleColumns.map((column) => (
          <div
            key={column.key}
            className={cn(
              "flex max-h-[640px] w-72 shrink-0 flex-col rounded-xl border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.03)]",
              columnTint(column.color),
            )}
          >
            <div
              className={cn(
                "flex items-center gap-2 rounded-t-xl px-3 py-2.5",
                columnTint(column.color),
              )}
            >
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-2 py-0.5 text-xs font-medium",
                  pillClasses(column.color),
                )}
              >
                <span
                  className={cn("h-1.5 w-1.5 rounded-full", dotClasses(column.color))}
                />
                {column.name}
                <span className="text-slate-500/80">{column.tasks.length}</span>
              </span>
            </div>
            <div
              className={cn(
                "flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-0",
                "[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/70 [&::-webkit-scrollbar-track]:bg-transparent",
              )}
            >
              {column.tasks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-[11px] uppercase tracking-wide text-slate-400">
                  Sin tareas
                </p>
              ) : (
                column.tasks.map((task) => <TaskCard key={task.id} task={task} />)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ListView = ({ tasks }: { tasks: CronogramaTask[] }) => {
  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const aDate = a.date?.start
        ? new Date(a.date.start).getTime()
        : Number.POSITIVE_INFINITY;
      const bDate = b.date?.start
        ? new Date(b.date.start).getTime()
        : Number.POSITIVE_INFINITY;
      if (aDate !== bDate) return aDate - bDate;
      return a.title.localeCompare(b.title, "es");
    });
  }, [tasks]);

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        No hay tareas que coincidan con los filtros aplicados.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Tarea</th>
            <th className="px-3 py-2 text-left font-medium">Estado</th>
            <th className="px-3 py-2 text-left font-medium">Proyecto</th>
            <th className="px-3 py-2 text-left font-medium">Fecha</th>
            <th className="px-3 py-2 text-left font-medium">Responsables</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {sorted.map((task) => (
            <tr key={task.id} className="hover:bg-slate-50/60">
              <td className="px-3 py-2">
                <a
                  href={task.url || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-slate-800 hover:text-slate-950"
                >
                  {task.title}
                </a>
              </td>
              <td className="px-3 py-2">
                {task.status.name ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      pillClasses(task.status.color),
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        dotClasses(task.status.color),
                      )}
                    />
                    {task.status.name}
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {task.tags.slice(0, 2).map((tag, index) => (
                    <span
                      key={`${tag.name}-${index}`}
                      className={cn(
                        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                        pillClasses(tag.color),
                      )}
                    >
                      {tag.name}
                    </span>
                  ))}
                  {task.tags.length > 2 && (
                    <span className="text-[10px] text-slate-500">
                      +{task.tags.length - 2}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-slate-600">
                {task.date?.start ? (
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                    {formatLongDate(task.date.start)}
                    {task.date.end && task.date.end !== task.date.start && (
                      <span className="text-slate-400">
                        → {formatLongDate(task.date.end)}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="px-3 py-2">
                <PeopleStack people={task.assignees} max={4} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

type TimelineRow = {
  task: CronogramaTask;
  startMs: number;
  endMs: number;
};

const TimelineView = ({ tasks }: { tasks: CronogramaTask[] }) => {
  const rows = useMemo<TimelineRow[]>(() => {
    return tasks
      .map((task) => {
        if (!task.date?.start) return null;
        const startMs = startOfDay(task.date.start);
        const endMs = task.date.end ? startOfDay(task.date.end) : startMs;
        return { task, startMs, endMs };
      })
      .filter((row): row is TimelineRow => row !== null)
      .sort((a, b) => a.startMs - b.startMs);
  }, [tasks]);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        No hay tareas con fechas asignadas para mostrar en el timeline.
      </div>
    );
  }

  const minMs = rows[0].startMs;
  const maxMs = Math.max(...rows.map((row) => row.endMs));
  const dayMs = 1000 * 60 * 60 * 24;
  const totalDays = Math.max(1, Math.round((maxMs - minMs) / dayMs) + 1);

  const monthMarkers: Array<{ label: string; offsetPct: number }> = [];
  const cursor = new Date(minMs);
  cursor.setDate(1);
  while (cursor.getTime() <= maxMs) {
    const offsetDays = Math.max(0, (cursor.getTime() - minMs) / dayMs);
    monthMarkers.push({
      label: new Intl.DateTimeFormat("es-CO", {
        month: "short",
        year: "2-digit",
      }).format(cursor),
      offsetPct: (offsetDays / totalDays) * 100,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="min-w-[760px]">
        <div className="relative h-7 border-b border-slate-200 bg-slate-50/60">
          {monthMarkers.map((marker, index) => (
            <span
              key={`${marker.label}-${index}`}
              className="absolute top-1.5 -translate-x-1/2 text-[11px] uppercase tracking-wide text-slate-500"
              style={{ left: `${marker.offsetPct}%` }}
            >
              {marker.label}
            </span>
          ))}
        </div>
        <ul className="divide-y divide-slate-100">
          {rows.map(({ task, startMs, endMs }) => {
            const leftPct = ((startMs - minMs) / dayMs / totalDays) * 100;
            const widthPct = Math.max(
              1.5,
              ((endMs - startMs) / dayMs / totalDays) * 100 + (1 / totalDays) * 100,
            );
            return (
              <li
                key={task.id}
                className="grid grid-cols-[minmax(220px,260px)_1fr] items-center gap-3 px-3 py-2 hover:bg-slate-50/60"
              >
                <div className="min-w-0">
                  <a
                    href={task.url || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-medium text-slate-800 hover:text-slate-950"
                    title={task.title}
                  >
                    {task.title}
                  </a>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    {task.status.name && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium",
                          pillClasses(task.status.color),
                        )}
                      >
                        <span
                          className={cn(
                            "h-1 w-1 rounded-full",
                            dotClasses(task.status.color),
                          )}
                        />
                        {task.status.name}
                      </span>
                    )}
                    {task.assignees.length > 0 && (
                      <PeopleStack people={task.assignees} max={2} />
                    )}
                  </div>
                </div>
                <div className="relative h-6">
                  <div className="absolute inset-y-2 left-0 right-0 rounded-full bg-slate-100" />
                  <div
                    className={cn(
                      "absolute inset-y-0.5 flex items-center rounded-full px-2 text-[10px] font-medium text-white shadow-sm",
                      barClasses(task.status.color),
                    )}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      minWidth: 28,
                    }}
                    title={`${formatLongDate(task.date?.start ?? null)} → ${formatLongDate(task.date?.end ?? task.date?.start ?? null)}`}
                  >
                    <span className="truncate">
                      {formatShortRange(task.date)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

const KpiCard = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
      {label}
    </p>
    <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
  </div>
);

const computeSummary = (tasks: CronogramaTask[]) => {
  let inProgress = 0;
  let waiting = 0;
  let blocked = 0;
  let done = 0;
  for (const task of tasks) {
    const name = task.status.name;
    if (matchesKeyword(name, STATUS_KEYWORDS.inProgress)) inProgress += 1;
    else if (matchesKeyword(name, STATUS_KEYWORDS.blocked)) blocked += 1;
    else if (matchesKeyword(name, STATUS_KEYWORDS.done)) done += 1;
    else if (matchesKeyword(name, STATUS_KEYWORDS.waiting)) waiting += 1;
  }
  return { total: tasks.length, inProgress, waiting, blocked, done };
};

const DatabaseSection = ({
  database,
  filters,
  viewMode,
  defaultCollapsed = false,
}: {
  database: CronogramaDatabase;
  filters: FilterState;
  viewMode: ViewMode;
  defaultCollapsed?: boolean;
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const filteredTasks = useMemo(
    () => database.tasks.filter((task) => taskMatchesFilters(task, filters)),
    [database.tasks, filters],
  );
  const emptyColumnsCount = useMemo(() => {
    if (viewMode !== "kanban") return 0;
    const columns = buildColumns(database, filteredTasks);
    return columns.filter((column) => column.tasks.length === 0).length;
  }, [database, filteredTasks, viewMode]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white/60 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <header className="flex items-center justify-between gap-3 px-1 pb-2">
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="inline-flex items-center gap-2 text-slate-800 transition hover:text-slate-950"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
          <span className="text-base font-semibold">{database.title}</span>
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600">
            {filteredTasks.length}
          </span>
        </button>
        {emptyColumnsCount > 0 && (
          <span className="text-[11px] text-slate-500">
            {filters.showEmptyColumns
              ? `${emptyColumnsCount} vacía${emptyColumnsCount === 1 ? "" : "s"} visibles`
              : `${emptyColumnsCount} vacía${emptyColumnsCount === 1 ? "" : "s"} ocultas`}
          </span>
        )}
      </header>
      {!collapsed && (
        <div>
          {viewMode === "kanban" && (
            <KanbanView
              database={database}
              filteredTasks={filteredTasks}
              showEmptyColumns={filters.showEmptyColumns}
            />
          )}
          {viewMode === "list" && <ListView tasks={filteredTasks} />}
          {viewMode === "timeline" && <TimelineView tasks={filteredTasks} />}
        </div>
      )}
    </section>
  );
};

const FilterChips = ({
  label,
  values,
  options,
  onChange,
  renderOption,
}: {
  label: string;
  values: string[];
  options: Array<{ value: string; label: string; person?: NotionPerson }>;
  onChange: (values: string[]) => void;
  renderOption?: (
    option: { value: string; label: string; person?: NotionPerson },
    isActive: boolean,
  ) => ReactNode;
}) => {
  if (options.length === 0) return null;
  const selected = new Set(values);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </span>
      {options.map((option) => {
        const isActive = selected.has(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() =>
              onChange(
                isActive
                  ? values.filter((value) => value !== option.value)
                  : [...values, option.value],
              )
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition",
              isActive
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
            )}
          >
            {renderOption ? renderOption(option, isActive) : option.label}
          </button>
        );
      })}
    </div>
  );
};

const ViewToggleButton = ({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof KanbanSquare;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition",
      active
        ? "bg-slate-900 text-white shadow-sm"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    )}
  >
    <Icon className="h-3.5 w-3.5" />
    {label}
  </button>
);

export default function CronogramaPage() {
  const router = useRouter();
  const { status: authStatus } = useRequireAuth();
  const authReady = authStatus === "authenticated";
  const [payload, setPayload] = useState<CronogramaPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [filters, setFilters] = useState<FilterState>({
    query: "",
    people: [],
    projects: [],
    showEmptyColumns: false,
  });

  const loadCronograma = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);
      setErrorDetail(null);
      try {
        const response = await fetch("/api/cronograma", { signal });
        const data = (await response.json()) as ApiResponse;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setError(data.error ?? "No se pudo cargar el cronograma.");
          setErrorDetail(data.detail ?? null);
          return;
        }
        setPayload(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Error desconocido al cargar.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!authReady) return;
    const controller = new AbortController();
    void loadCronograma(controller.signal);
    return () => controller.abort();
  }, [authReady, loadCronograma]);

  const allTasks = useMemo(
    () => payload?.databases.flatMap((db) => db.tasks) ?? [],
    [payload],
  );

  const filteredTasks = useMemo(
    () => allTasks.filter((task) => taskMatchesFilters(task, filters)),
    [allTasks, filters],
  );

  const peopleOptions = useMemo(() => {
    const map = new Map<string, NotionPerson>();
    for (const task of allTasks) {
      for (const person of task.assignees) {
        if (!person.id) continue;
        if (!map.has(person.id)) map.set(person.id, person);
      }
    }
    return Array.from(map.values())
      .map((person) => ({
        value: person.id,
        label: person.name ?? "Sin nombre",
        person,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [allTasks]);

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const task of allTasks) {
      for (const tag of task.tags) {
        if (tag.name) set.add(tag.name);
      }
    }
    return Array.from(set)
      .map((value) => ({ value, label: value }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [allTasks]);

  const globalSummary = useMemo(
    () => computeSummary(filteredTasks),
    [filteredTasks],
  );

  const hasActiveFilters =
    filters.query.length > 0 ||
    filters.people.length > 0 ||
    filters.projects.length > 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppTopBar />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/secciones"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500 hover:text-slate-800"
            >
              <LayoutGrid className="h-3 w-3" />
              Panel de gestión
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              {payload?.page.title ?? "Cronograma de Proyectos"}
            </h1>
            <p className="text-sm text-slate-500">
              Visualiza el avance de proyectos y tareas del equipo en tiempo
              real.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
              <ViewToggleButton
                active={viewMode === "kanban"}
                icon={KanbanSquare}
                label="Kanban"
                onClick={() => setViewMode("kanban")}
              />
              <ViewToggleButton
                active={viewMode === "timeline"}
                icon={GanttChartSquare}
                label="Timeline"
                onClick={() => setViewMode("timeline")}
              />
              <ViewToggleButton
                active={viewMode === "list"}
                icon={List}
                label="Lista"
                onClick={() => setViewMode("list")}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadCronograma()}
              disabled={isLoading}
              className="gap-1.5 border-slate-200 bg-white"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
              />
              Actualizar
            </Button>
            {payload?.page.url && (
              <a
                href={payload.page.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-slate-800"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir en Notion
              </a>
            )}
            <Link
              href="/secciones"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver
            </Link>
          </div>
        </header>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold">{error}</p>
              {errorDetail && (
                <p className="text-xs text-rose-700/80">{errorDetail}</p>
              )}
            </div>
          </div>
        )}

        {isLoading && !payload && (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Cargando cronograma desde Notion...
          </div>
        )}

        {payload && (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <KpiCard label="Total" value={globalSummary.total} />
              <KpiCard label="En curso" value={globalSummary.inProgress} />
              <KpiCard label="En espera" value={globalSummary.waiting} />
              <KpiCard label="Atrasadas" value={globalSummary.blocked} />
              <KpiCard label="Terminadas" value={globalSummary.done} />
            </section>

            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={filters.query}
                    onChange={(event) =>
                      setFilters((prev) => ({
                        ...prev,
                        query: event.target.value,
                      }))
                    }
                    placeholder="Buscar proyectos o tareas..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50/60 py-2 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </div>
                <FilterChips
                  label="Responsables"
                  values={filters.people}
                  options={peopleOptions}
                  onChange={(people) =>
                    setFilters((prev) => ({ ...prev, people }))
                  }
                  renderOption={(option, isActive) => (
                    <>
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold",
                          isActive
                            ? "bg-white/20 text-white"
                            : option.person
                              ? `${personPalette(option.person)} text-white`
                              : "bg-slate-200 text-slate-700",
                        )}
                      >
                        {initialsFromName(option.label)}
                      </span>
                      <span>{option.label}</span>
                    </>
                  )}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <FilterChips
                  label="Proyectos"
                  values={filters.projects}
                  options={projectOptions}
                  onChange={(projects) =>
                    setFilters((prev) => ({ ...prev, projects }))
                  }
                />
                <div className="ml-auto flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={filters.showEmptyColumns}
                      onChange={(event) =>
                        setFilters((prev) => ({
                          ...prev,
                          showEmptyColumns: event.target.checked,
                        }))
                      }
                      className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-200"
                    />
                    Mostrar columnas vacías
                  </label>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={() =>
                        setFilters((prev) => ({
                          query: "",
                          people: [],
                          projects: [],
                          showEmptyColumns: prev.showEmptyColumns,
                        }))
                      }
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                    >
                      <X className="h-3 w-3" />
                      Limpiar filtros
                    </button>
                  )}
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                    <SlidersHorizontal className="h-3 w-3" />
                    {filteredTasks.length} de {allTasks.length}
                  </span>
                </div>
              </div>
            </section>

            {payload.databases.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
                <p className="text-sm text-slate-600">
                  La página de Notion no tiene bases de datos embebidas.
                </p>
              </div>
            )}

            <div className="space-y-5">
              {payload.databases.map((database) => (
                <DatabaseSection
                  key={database.id}
                  database={database}
                  filters={filters}
                  viewMode={viewMode}
                />
              ))}
            </div>

            <footer className="flex flex-wrap items-center justify-center gap-2 pt-4 text-xs text-slate-400">
              <span>
                Datos sincronizados · {formatSyncStamp(payload.fetchedAt)}
              </span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
