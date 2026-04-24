"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  LayoutGrid,
  LogOut,
  Pencil,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { BRANCH_LOCATIONS, DEFAULT_LINES } from "@/lib/constants";
import {
  PORTAL_SUBSECTIONS_BY_SECTION,
  PORTAL_SECTION_LABEL_BY_ID,
  PORTAL_SECTIONS,
  resolvePortalSubsectionId,
  resolvePortalSectionId,
} from "@/lib/portal-sections";
import { normalizeKeySpaced } from "@/lib/normalize";

const ALL_SEDES_VALUE = "Todas";
const EXTRA_SEDES = [
  "ADM",
  "CEDI-CAVASA",
  "Panificadora",
  "Planta Desposte Mixto",
  "Planta Desprese Pollo",
];
const USER_SEDE_OPTIONS = [...BRANCH_LOCATIONS, ...EXTRA_SEDES];

type UserRow = {
  id: string;
  username: string;
  role: "admin" | "user";
  sede: string | null;
  allowedSedes: string[] | null;
  allowedLines: string[] | null;
  allowedDashboards: string[] | null;
  allowedSubdashboards: string[] | null;
  specialRoles: string[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  last_login_ip: string | null;
};

type LogRow = {
  id: number;
  logged_at: string;
  ip: string | null;
  user_agent: string | null;
  user_id: string;
  username: string;
};

type UserFormState = {
  id?: string;
  username: string;
  role: "admin" | "user";
  sede: string;
  allowedSedes: string[];
  allowedLines: string[];
  allowedDashboards: string[];
  allowedSubdashboards: string[];
  specialRoles: string[];
  password: string;
  is_active: boolean;
};

const emptyForm: UserFormState = {
  username: "",
  role: "user",
  sede: "",
  allowedSedes: [],
  allowedLines: [],
  allowedDashboards: [],
  allowedSubdashboards: [],
  specialRoles: [],
  password: "",
  is_active: true,
};

const USERS_PAGE_SIZE = 10;
const RECENT_ACCESS_LOGS_LIMIT = 6;
const APP_VERSION_LABEL = "UAID V4.0";

const AVATAR_STYLES = [
  { bg: "bg-teal-500", text: "text-white" },
  { bg: "bg-sky-600", text: "text-white" },
  { bg: "bg-indigo-600", text: "text-white" },
  { bg: "bg-fuchsia-500", text: "text-white" },
  { bg: "bg-amber-500", text: "text-white" },
  { bg: "bg-emerald-600", text: "text-white" },
];

const userInitials = (username: string) => {
  const t = username.trim();
  if (t.length <= 1) return t.toUpperCase() || "?";
  if (t.includes(" ") || t.includes(".")) {
    const parts = t.split(/[\s.]+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    }
  }
  return t.slice(0, 2).toUpperCase();
};

const formatRelativeTime = (isoDate: string) => {
  const eventTime = new Date(isoDate).getTime();
  const now = Date.now();
  const diffMs = eventTime - now;
  const absMinutes = Math.round(Math.abs(diffMs) / 60000);
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

  if (absMinutes < 1) return "ahora";
  if (absMinutes < 60) return rtf.format(Math.round(diffMs / 60000), "minute");

  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return rtf.format(Math.round(diffMs / 3600000), "hour");

  return rtf.format(Math.round(diffMs / 86400000), "day");
};

const normalizeSedeKey = normalizeKeySpaced;

const inferSedeFromUsername = (username?: string | null) => {
  if (!username) return null;
  const normalized = username.trim().toLowerCase();
  if (!normalized.startsWith("sede_")) return null;
  const raw = normalized.replace(/^sede_/, "").replace(/_/g, " ");
  const rawKey = normalizeSedeKey(raw);

  const match = BRANCH_LOCATIONS.find((sede) => {
    const sedeKey = normalizeSedeKey(sede);
    return (
      sedeKey === rawKey || sedeKey.includes(rawKey) || rawKey.includes(sedeKey)
    );
  });
  return match ?? null;
};

const lineLabelById = new Map(
  DEFAULT_LINES.map((line) => [line.id, line.name]),
);
const SECTION_OPTIONS = PORTAL_SECTIONS.map((section) => ({
  id: section.id,
  label: section.label,
}));
const SUBSECTION_LABELS: Record<string, string> = {
  "ventas-x-item": "Ventas por item",
  "inventario-x-item": "Inventario x item",
  "analisis-de-inventario": "Analisis de inventario",
  "mix-y-linea": "Mix y linea",
  margenes: "Margenes",
  rotacion: "Rotacion",
  "consulta-operativa": "Consulta operativa",
  "planilla-vs-asistencia": "Planilla vs asistencia",
  "registro-de-horarios": "Registro de horarios",
};
const SPECIAL_ROLE_OPTIONS = [
  { id: "alex", label: "Alex" },
  { id: "cronograma", label: "Cronograma" },
  {
    id: "replicar_lunes",
    label: "Replicar lunes",
  },
  { id: "rotacion", label: "Rotacion" },
  { id: "comparar_horarios", label: "Comparar horarios" },
  { id: "abcd", label: "ABCD" },
];

const formatAllowedLines = (allowedLines: string[] | null) => {
  if (!allowedLines || allowedLines.length === 0) return "Todas";
  return allowedLines
    .map((lineId) => lineLabelById.get(lineId) ?? lineId)
    .join(", ");
};
const formatAllowedDashboards = (allowedDashboards: string[] | null) => {
  if (allowedDashboards === null) return "Todas";
  if (allowedDashboards.length === 0) return "Sin secciones";
  return allowedDashboards
    .map((boardId) => {
      const normalizedBoardId = resolvePortalSectionId(boardId);
      return normalizedBoardId
        ? (PORTAL_SECTION_LABEL_BY_ID.get(normalizedBoardId) ?? boardId)
        : boardId;
    })
    .join(", ");
};
const formatAllowedSubdashboards = (allowedSubdashboards: string[] | null) => {
  if (allowedSubdashboards === null) return "Todos";
  if (allowedSubdashboards.length === 0) return "Sin subtableros";
  return allowedSubdashboards
    .map((subId) => {
      const normalizedSubId = resolvePortalSubsectionId(subId);
      return normalizedSubId ? (SUBSECTION_LABELS[normalizedSubId] ?? subId) : subId;
    })
    .join(", ");
};
const formatAllowedSedes = (
  allowedSedes: string[] | null,
  fallbackSede: string | null,
) => {
  if (allowedSedes && allowedSedes.length > 0) {
    return allowedSedes.join(", ");
  }
  return fallbackSede ?? "-";
};

const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  if (!value) return null;
  return decodeURIComponent(value.split("=").slice(1).join("="));
};

export default function AdminUsuariosPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formState, setFormState] = useState<UserFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [usersPage, setUsersPage] = useState(1);

  const getCsrfToken = () => getCookieValue("vp_csrf");

  const requireCsrfToken = () => {
    const token = getCsrfToken();
    if (!token) {
      setError("No se pudo validar la sesión. Recarga la página.");
      return null;
    }
    return token;
  };

  const handleAuthFailure = useCallback(
    (status: number) => {
      if (status === 401) {
        setError("Tu sesion expiro. Inicia sesion de nuevo para continuar.");
        router.replace("/login");
        return true;
      }
      if (status === 403) {
        setError(
          "Tu usuario no tiene permisos de administracion en este momento.",
        );
        router.replace("/secciones");
        return true;
      }
      return false;
    },
    [router],
  );

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.username.localeCompare(b.username, "es")),
    [users],
  );
  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((user) => user.is_active).length;
    const admins = users.filter((user) => user.role === "admin").length;
    return { total, active, admins };
  }, [users]);

  const newUsersThisMonth = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return users.filter(
      (u) => new Date(u.created_at).getTime() >= start,
    ).length;
  }, [users]);

  const filteredTableUsers = useMemo(() => {
    let list = sortedUsers;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((u) => u.username.toLowerCase().includes(q));
    }
    if (roleFilter !== "all") {
      list = list.filter((u) => u.role === roleFilter);
    }
    return list;
  }, [sortedUsers, searchQuery, roleFilter]);

  const usersTotalPages = Math.max(
    1,
    Math.ceil(filteredTableUsers.length / USERS_PAGE_SIZE),
  );

  const paginatedTableUsers = useMemo(() => {
    const start = (usersPage - 1) * USERS_PAGE_SIZE;
    return filteredTableUsers.slice(start, start + USERS_PAGE_SIZE);
  }, [filteredTableUsers, usersPage]);

  useEffect(() => {
    setUsersPage(1);
  }, [searchQuery, roleFilter]);

  useEffect(() => {
    if (usersPage > usersTotalPages) {
      setUsersPage(usersTotalPages);
    }
  }, [usersPage, usersTotalPages]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) {
        handleAuthFailure(meRes.status);
        return;
      }
      const mePayload = (await meRes.json()) as { user?: { role?: string } };
      if (mePayload.user?.role !== "admin") {
        router.replace("/secciones");
        return;
      }
      setIsAdmin(true);

      const [usersRes, logsRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch(`/api/admin/login-logs?limit=${RECENT_ACCESS_LOGS_LIMIT}`),
      ]);

      if (
        handleAuthFailure(usersRes.status) ||
        handleAuthFailure(logsRes.status)
      ) {
        return;
      }
      if (!usersRes.ok) throw new Error("No se pudieron cargar los usuarios.");
      if (!logsRes.ok) throw new Error("No se pudieron cargar los accesos.");

      const usersPayload = (await usersRes.json()) as { users: UserRow[] };
      const logsPayload = (await logsRes.json()) as { logs: LogRow[] };
      setUsers(usersPayload.users ?? []);
      setLogs(logsPayload.logs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }, [handleAuthFailure, router]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!formOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeForm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [formOpen]);

  const openCreate = () => {
    setFormState(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (user: UserRow) => {
    setFormState({
      id: user.id,
      username: user.username,
      role: user.role,
      sede: user.sede ?? inferSedeFromUsername(user.username) ?? "",
      allowedSedes: user.allowedSedes ?? (user.sede ? [user.sede] : []),
      allowedLines: user.allowedLines ?? [],
      allowedDashboards: user.allowedDashboards ?? [],
      allowedSubdashboards: user.allowedSubdashboards ?? [],
      specialRoles: user.specialRoles ?? [],
      password: "",
      is_active: user.is_active,
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setFormState(emptyForm);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const csrfToken = requireCsrfToken();
      if (!csrfToken) {
        setSaving(false);
        return;
      }

      if (formState.role === "user" && formState.allowedSedes.length === 0) {
        throw new Error(
          "Debes seleccionar al menos una sede para usuarios de rol user.",
        );
      }

      const payload = {
        username: formState.username,
        role: formState.role,
        sede:
          formState.role === "admin"
            ? null
            : (formState.allowedSedes[0] ?? formState.sede ?? null),
        allowedSedes:
          formState.role === "admin"
            ? null
            : formState.allowedSedes.length > 0
              ? formState.allowedSedes
              : null,
        allowedLines:
          formState.role === "admin"
            ? null
            : formState.allowedLines.length > 0
              ? formState.allowedLines
              : null,
        allowedDashboards:
          formState.role === "admin"
            ? null
            : formState.allowedDashboards.length > 0
              ? formState.allowedDashboards
              : null,
        allowedSubdashboards:
          formState.role === "admin"
            ? null
            : formState.allowedSubdashboards.length > 0
              ? formState.allowedSubdashboards
              : null,
        specialRoles:
          formState.role === "admin"
            ? null
            : formState.specialRoles.length > 0
              ? formState.specialRoles
              : null,
        password: formState.password,
        is_active: formState.is_active,
      };

      const response = await fetch(
        formState.id ? `/api/admin/users/${formState.id}` : "/api/admin/users",
        {
          method: formState.id ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify(payload),
        },
      );

      if (handleAuthFailure(response.status)) {
        return;
      }
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "No se pudo guardar el usuario.");
      }

      closeForm();
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("¿Seguro que deseas eliminar este usuario?")) return;
    setError(null);
    const csrfToken = requireCsrfToken();
    if (!csrfToken) return;
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "DELETE",
      headers: { "x-csrf-token": csrfToken },
    });
    if (handleAuthFailure(response.status)) {
      return;
    }
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "No se pudo eliminar el usuario.");
      return;
    }
    await loadData();
  };

  const handleLogout = async () => {
    const csrfToken = requireCsrfToken();
    if (!csrfToken) return;
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
    });
    router.replace("/login");
  };

  const handleClearLogs = async () => {
    if (!confirm("¿Deseas borrar todos los accesos recientes?")) return;
    setError(null);
    const csrfToken = requireCsrfToken();
    if (!csrfToken) return;
    const response = await fetch("/api/admin/login-logs", {
      method: "DELETE",
      headers: { "x-csrf-token": csrfToken },
    });
    if (handleAuthFailure(response.status)) {
      return;
    }
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "No se pudieron borrar los accesos.");
      return;
    }
    await loadData();
  };

  return (
    <div className="min-h-screen bg-[#f7f7f8] px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[min(100%,112rem)] flex-col gap-6">
        <header className="flex flex-col gap-6 rounded-xl border border-slate-200/90 bg-white p-6 shadow-sm sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-md shadow-indigo-600/25">
              <Sparkles className="h-5 w-5" strokeWidth={2} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Administración <span className="text-slate-400">●</span>{" "}
                {APP_VERSION_LABEL}
              </p>
              <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Usuarios de la aplicación
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
                Gestiona roles, accesos por sección y actividad reciente del
                portal.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Link
              href="/secciones"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <LayoutGrid className="h-4 w-4 text-slate-500" />
              Ir a secciones
            </Link>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3.5 text-xs font-semibold text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-700"
            >
              <UserPlus className="h-4 w-4" />
              Nuevo usuario
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-slate-500 transition hover:text-slate-800"
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
            Cargando usuarios...
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
              <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0">
                <div className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                      <Users className="h-5 w-5" />
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                      +{newUsersThisMonth} este mes
                    </span>
                  </div>
                  <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Total usuarios
                  </p>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
                    {stats.total}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Cuentas registradas
                  </p>
                </div>
                <div className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <UserCheck className="h-5 w-5" />
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50/80 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      LIVE
                    </span>
                  </div>
                  <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Usuarios activos
                  </p>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
                    {stats.active}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Con acceso habilitado
                  </p>
                </div>
                <div className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                      Nivel raíz
                    </span>
                  </div>
                  <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Administradores
                  </p>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
                    {String(stats.admins).padStart(2, "0")}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Roles con permisos totales
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
              <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">
                      Usuarios
                    </h2>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                      {filteredTableUsers.length} registrados
                    </span>
                  </div>
                  <div className="flex flex-1 flex-wrap items-center gap-2 sm:max-w-xl sm:justify-end">
                    <div className="relative min-w-[200px] flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="search"
                        placeholder="Buscar usuario..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/80 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setFiltersOpen((o) => !o)}
                      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition ${
                        filtersOpen || roleFilter !== "all"
                          ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <Filter className="h-4 w-4" />
                      Filtros
                    </button>
                  </div>
                </div>
                {filtersOpen && (
                  <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50/50 px-4 py-3 sm:px-5">
                    <span className="mr-1 text-xs font-medium text-slate-500">
                      Rol:
                    </span>
                    {(
                      [
                        ["all", "Todos"],
                        ["admin", "Admin"],
                        ["user", "User"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setRoleFilter(value)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                          roleFilter === value
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                        <th className="px-4 py-3">Usuario</th>
                        <th className="px-3 py-3">Rol</th>
                        <th className="px-3 py-3">Sede</th>
                        <th className="px-3 py-3">Líneas</th>
                        <th className="px-3 py-3">Secciones</th>
                        <th className="px-3 py-3">Subtableros</th>
                        <th className="px-3 py-3">Especial</th>
                        <th className="px-3 py-3">Estado</th>
                        <th className="px-4 py-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedTableUsers.map((user, index) => {
                        const palette =
                          AVATAR_STYLES[index % AVATAR_STYLES.length]!;
                        return (
                          <tr
                            key={user.id}
                            className="border-b border-slate-100 transition-colors hover:bg-slate-50/90"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${palette.bg} ${palette.text}`}
                                >
                                  {userInitials(user.username)}
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate font-semibold text-slate-900">
                                    {user.username}
                                  </div>
                                  <div className="truncate text-xs text-slate-500">
                                    {user.username}@portal
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              {user.role === "admin" ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
                                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                                  Admin
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                  User
                                </span>
                              )}
                            </td>
                            <td className="max-w-[140px] px-3 py-3 text-xs text-slate-600">
                              {user.role === "admin"
                                ? "—"
                                : formatAllowedSedes(
                                    user.allowedSedes,
                                    user.sede ??
                                      inferSedeFromUsername(user.username),
                                  )}
                            </td>
                            <td className="max-w-[120px] px-3 py-3 text-xs text-slate-600">
                              {user.role === "admin"
                                ? "—"
                                : formatAllowedLines(user.allowedLines)}
                            </td>
                            <td className="max-w-[160px] px-3 py-3 text-xs text-slate-600">
                              {user.role === "admin"
                                ? "—"
                                : formatAllowedDashboards(
                                    user.allowedDashboards,
                                  )}
                            </td>
                            <td className="max-w-[220px] px-3 py-3 text-xs text-slate-600">
                              {user.role === "admin"
                                ? "—"
                                : formatAllowedSubdashboards(
                                    user.allowedSubdashboards,
                                  )}
                            </td>
                            <td className="max-w-[120px] px-3 py-3 text-xs text-slate-600">
                              {user.role === "admin"
                                ? "—"
                                : user.specialRoles &&
                                    user.specialRoles.length > 0
                                  ? user.specialRoles.join(", ")
                                  : "—"}
                            </td>
                            <td className="px-3 py-3">
                              <span
                                className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                                  user.is_active
                                    ? "text-emerald-600"
                                    : "text-rose-600"
                                }`}
                              >
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    user.is_active
                                      ? "bg-emerald-500"
                                      : "bg-rose-500"
                                  }`}
                                />
                                {user.is_active ? "Activo" : "Inactivo"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEdit(user)}
                                  className="rounded-lg p-1.5 text-indigo-600 transition hover:bg-indigo-50"
                                  title="Editar"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(user.id)}
                                  className="rounded-lg p-1.5 text-rose-600 transition hover:bg-rose-50"
                                  title="Eliminar"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {filteredTableUsers.length === 0 && (
                    <div className="py-12 text-center text-sm text-slate-500">
                      {sortedUsers.length === 0
                        ? "No hay usuarios registrados todavía."
                        : "No hay usuarios que coincidan con la búsqueda o filtros."}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <p className="text-sm text-slate-500">
                    {filteredTableUsers.length === 0 ? (
                      <>Mostrando 0 de {sortedUsers.length} usuarios</>
                    ) : (
                      <>
                        Mostrando{" "}
                        {(usersPage - 1) * USERS_PAGE_SIZE + 1} a{" "}
                        {Math.min(
                          usersPage * USERS_PAGE_SIZE,
                          filteredTableUsers.length,
                        )}{" "}
                        de {filteredTableUsers.length} usuarios
                        {searchQuery.trim() || roleFilter !== "all"
                          ? ` (total ${sortedUsers.length})`
                          : ""}
                      </>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={usersPage <= 1}
                      onClick={() => setUsersPage((p) => Math.max(1, p - 1))}
                      className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Anterior
                    </button>
                    <span className="hidden text-xs text-slate-500 sm:inline">
                      Página {usersPage} de {usersTotalPages}
                    </span>
                    <button
                      type="button"
                      disabled={usersPage >= usersTotalPages}
                      onClick={() =>
                        setUsersPage((p) => Math.min(usersTotalPages, p + 1))
                      }
                      className="inline-flex h-8 items-center rounded-lg border border-slate-900 bg-white px-3 text-xs font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Siguiente
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              <aside className="flex flex-col rounded-xl border border-slate-100 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 p-4 sm:p-5">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Accesos recientes
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Últimos {RECENT_ACCESS_LOGS_LIMIT} eventos
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={handleClearLogs}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Borrar
                    </button>
                  )}
                </div>
                <div className="relative flex-1 p-4 sm:p-5">
                  <div className="absolute bottom-6 left-[1.35rem] top-8 w-px bg-slate-200" />
                  <ul className="relative space-y-0">
                    {logs.map((log, logIndex) => {
                      const lp =
                        AVATAR_STYLES[logIndex % AVATAR_STYLES.length]!;
                      return (
                        <li key={log.id} className="relative pl-10 pb-6 last:pb-0">
                          <div
                            className={`absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold ${lp.bg} ${lp.text} ring-4 ring-white`}
                          >
                            {userInitials(log.username)}
                          </div>
                          <div
                            className={`rounded-lg border p-3 ${
                              logIndex === 0
                                ? "border-indigo-200 bg-indigo-50/60"
                                : "border-slate-100 bg-slate-50/80"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-semibold text-slate-900">
                                {log.username}
                              </span>
                              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Login
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatRelativeTime(log.logged_at)}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-400">
                              {log.ip ?? "Origen auditado desconocido"}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {logs.length === 0 && (
                    <p className="text-sm text-slate-500">
                      Sin accesos registrados.
                    </p>
                  )}
                </div>
                <div className="border-t border-slate-100 p-4">
                  <Link
                    href="/admin/usuarios/accesos"
                    className="inline-flex items-center gap-1 text-sm font-medium text-sky-600 transition hover:text-sky-700 hover:underline"
                  >
                    Ver registro completo
                    <span aria-hidden>→</span>
                  </Link>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>

      {formOpen && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/45 p-2 backdrop-blur-[2px] sm:p-4"
          onClick={closeForm}
        >
          <div className="flex min-h-full items-start justify-center py-2 sm:items-center sm:py-4">
            <div
              className="flex w-full max-w-xl max-h-[calc(100vh-1rem)] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_35px_90px_-45px_rgba(15,23,42,0.6)] sm:max-h-[calc(100vh-2rem)] sm:rounded-3xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="shrink-0 border-b border-slate-200/70 bg-linear-to-r from-slate-50 to-blue-50/45 px-4 py-4 sm:px-6 sm:py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                  Administración
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">
                  {formState.id ? "Editar usuario" : "Nuevo usuario"}
                </h2>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
                <div className="space-y-4">
                  <label className="block text-sm font-medium text-slate-700">
                    Usuario
                    <input
                      value={formState.username}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          username: e.target.value,
                        }))
                      }
                      className="mt-1.5 w-full rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Rol
                      <select
                        value={formState.role}
                        onChange={(e) =>
                          setFormState((prev) => ({
                            ...prev,
                            role: e.target.value as "admin" | "user",
                            sede: e.target.value === "admin" ? "" : prev.sede,
                            allowedSedes:
                              e.target.value === "admin"
                                ? []
                                : prev.allowedSedes,
                            specialRoles:
                              e.target.value === "admin"
                                ? []
                                : prev.specialRoles,
                            allowedSubdashboards:
                              e.target.value === "admin"
                                ? []
                                : prev.allowedSubdashboards,
                          }))
                        }
                        className="mt-1.5 w-full rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        <option value="user">Usuario</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </label>

                    <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                      Sedes permitidas{" "}
                      {formState.role === "user"
                        ? "(obligatoria: 1 o más)"
                        : "(solo user)"}
                      <div className="mt-1.5 grid max-h-28 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 shadow-sm min-[420px]:grid-cols-2 sm:grid-cols-3">
                        {[ALL_SEDES_VALUE, ...USER_SEDE_OPTIONS].map((sede) => {
                          const checked = formState.allowedSedes.includes(sede);
                          return (
                            <label
                              key={sede}
                              className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={formState.role !== "user"}
                                onChange={() =>
                                  setFormState((prev) => {
                                    if (checked) {
                                      return {
                                        ...prev,
                                        allowedSedes: prev.allowedSedes.filter(
                                          (id) => id !== sede,
                                        ),
                                      };
                                    }
                                    return {
                                      ...prev,
                                      allowedSedes: [
                                        ...prev.allowedSedes,
                                        sede,
                                      ],
                                    };
                                  })
                                }
                                className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-200 disabled:cursor-not-allowed"
                              />
                              <span className="wrap-break-words">{sede}</span>
                            </label>
                          );
                        })}
                      </div>
                    </label>

                    <label className="block text-sm font-medium text-slate-700">
                      Contraseña {formState.id ? "(opcional)" : "(mín 8)"}
                      <input
                        type="password"
                        value={formState.password}
                        onChange={(e) =>
                          setFormState((prev) => ({
                            ...prev,
                            password: e.target.value,
                          }))
                        }
                        className="mt-1.5 w-full rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>

                    <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                      Secciones permitidas (vacio = todas)
                      <div className="mt-1.5 grid max-h-28 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 shadow-sm min-[420px]:grid-cols-2 sm:grid-cols-3">
                        {SECTION_OPTIONS.map((section) => {
                          const checked = formState.allowedDashboards.includes(
                            section.id,
                          );
                          return (
                            <label
                              key={section.id}
                              className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={formState.role !== "user"}
                                onChange={() =>
                                  setFormState((prev) => ({
                                    ...prev,
                                    allowedDashboards: checked
                                      ? prev.allowedDashboards.filter(
                                          (id) => id !== section.id,
                                        )
                                      : [...prev.allowedDashboards, section.id],
                                  }))
                                }
                                className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-200 disabled:cursor-not-allowed"
                              />
                              <span className="wrap-break-words">
                                {section.label}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </label>

                    <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                      Subtableros permitidos (vacio = todos)
                      <div className="mt-1.5 space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 shadow-sm">
                        {PORTAL_SECTIONS.map((section) => (
                          <div key={section.id}>
                            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                              {section.label}
                            </p>
                            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-3">
                              {PORTAL_SUBSECTIONS_BY_SECTION[section.id].map((subId) => {
                                const checked = formState.allowedSubdashboards.includes(
                                  subId,
                                );
                                return (
                                  <label
                                    key={subId}
                                    className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={formState.role !== "user"}
                                      onChange={() =>
                                        setFormState((prev) => ({
                                          ...prev,
                                          allowedSubdashboards: checked
                                            ? prev.allowedSubdashboards.filter(
                                                (id) => id !== subId,
                                              )
                                            : [...prev.allowedSubdashboards, subId],
                                        }))
                                      }
                                      className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-200 disabled:cursor-not-allowed"
                                    />
                                    <span className="wrap-break-words">
                                      {SUBSECTION_LABELS[subId] ?? subId}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </label>

                    <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                      Roles especiales
                      <p className="mt-1 text-[11px] font-normal leading-snug text-slate-500">
                        Los administradores tienen acceso a Rotacion y Comparar
                        horarios sin activar esos roles; aqui solo aplica a
                        usuarios con rol user. El rol ABCD permite editar los
                        umbrales de clasificacion en Rotacion (administradores
                        tambien pueden).
                      </p>
                      <div className="mt-1.5 grid max-h-20 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 shadow-sm min-[420px]:grid-cols-2 sm:grid-cols-3">
                        {SPECIAL_ROLE_OPTIONS.map((role) => {
                          const checked = formState.specialRoles.includes(
                            role.id,
                          );
                          return (
                            <label
                              key={role.id}
                              className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={formState.role !== "user"}
                                onChange={() =>
                                  setFormState((prev) => ({
                                    ...prev,
                                    specialRoles: checked
                                      ? prev.specialRoles.filter(
                                          (id) => id !== role.id,
                                        )
                                      : [...prev.specialRoles, role.id],
                                  }))
                                }
                                className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-200 disabled:cursor-not-allowed"
                              />
                              <span className="wrap-break-words">
                                {role.label}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </label>

                    <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                      Lineas permitidas (vacío = todas)
                      <div className="mt-1.5 grid max-h-32 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 shadow-sm min-[420px]:grid-cols-2 sm:grid-cols-3">
                        {DEFAULT_LINES.map((line) => {
                          const checked = formState.allowedLines.includes(
                            line.id,
                          );
                          return (
                            <label
                              key={line.id}
                              className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={formState.role !== "user"}
                                onChange={() =>
                                  setFormState((prev) => ({
                                    ...prev,
                                    allowedLines: checked
                                      ? prev.allowedLines.filter(
                                          (id) => id !== line.id,
                                        )
                                      : [...prev.allowedLines, line.id],
                                  }))
                                }
                                className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-200 disabled:cursor-not-allowed"
                              />
                              <span className="wrap-break-words">
                                {line.name}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </label>
                  </div>

                  <label className="inline-flex items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
                    <input
                      type="checkbox"
                      checked={formState.is_active}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          is_active: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-200"
                    />
                    Cuenta activa
                  </label>
                </div>
              </div>

              <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200/70 bg-slate-50/60 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-full border border-slate-300/80 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 transition-colors hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-full border border-indigo-500/80 bg-indigo-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-[0_10px_24px_-14px_rgba(79,70,229,0.45)] transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
