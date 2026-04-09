"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock3,
  LayoutGrid,
  LogOut,
  Pencil,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { BRANCH_LOCATIONS, DEFAULT_LINES } from "@/lib/constants";
import {
  PORTAL_SECTION_LABEL_BY_ID,
  PORTAL_SECTIONS,
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
  specialRoles: [],
  password: "",
  is_active: true,
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
    return sedeKey === rawKey || sedeKey.includes(rawKey) || rawKey.includes(sedeKey);
  });
  return match ?? null;
};

const lineLabelById = new Map(DEFAULT_LINES.map((line) => [line.id, line.name]));
const SECTION_OPTIONS = PORTAL_SECTIONS.map((section) => ({
  id: section.id,
  label: section.label,
}));
const SPECIAL_ROLE_OPTIONS = [{ id: "alex", label: "Alex" }];

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
        ? PORTAL_SECTION_LABEL_BY_ID.get(normalizedBoardId) ?? boardId
        : boardId;
    })
    .join(", ");
};
const formatAllowedSedes = (allowedSedes: string[] | null, fallbackSede: string | null) => {
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

  const getCsrfToken = () => getCookieValue("vp_csrf");

  const requireCsrfToken = () => {
    const token = getCsrfToken();
    if (!token) {
      setError("No se pudo validar la sesión. Recarga la página.");
      return null;
    }
    return token;
  };

  const handleAuthFailure = useCallback((status: number) => {
    if (status === 401) {
      setError("Tu sesion expiro. Inicia sesion de nuevo para continuar.");
      router.replace("/login");
      return true;
    }
    if (status === 403) {
      setError("Tu usuario no tiene permisos de administracion en este momento.");
      router.replace("/secciones");
      return true;
    }
    return false;
  }, [router]);

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
        fetch("/api/admin/login-logs?limit=25"),
      ]);

      if (handleAuthFailure(usersRes.status) || handleAuthFailure(logsRes.status)) {
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
        throw new Error("Debes seleccionar al menos una sede para usuarios de rol user.");
      }

      const payload = {
        username: formState.username,
        role: formState.role,
        sede:
          formState.role === "admin"
            ? null
            : formState.allowedSedes[0] ?? formState.sede ?? null,
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
    <div className="relative min-h-screen overflow-hidden bg-slate-50 px-4 py-10 text-slate-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-mercamio-200/40 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-sky-200/40 blur-3xl" />
        <div className="absolute top-1/3 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-slate-200/50 blur-3xl" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/60 bg-white/80 p-6 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.35)] backdrop-blur">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
              Administración
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900 md:text-3xl">
              Usuarios de la aplicación
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-500">
              Gestiona roles, accesos por seccion y actividad reciente del
              portal UAID.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/secciones"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 transition-all hover:-translate-y-0.5 hover:bg-slate-50"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Ir a secciones
            </Link>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-full border border-slate-900/90 bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-[0_14px_30px_-16px_rgba(15,23,42,0.6)] transition-all hover:-translate-y-0.5 hover:bg-slate-800"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Nuevo usuario
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 transition-all hover:-translate-y-0.5 hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              Cerrar sesión
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-2 text-sm text-amber-700 shadow-[0_16px_40px_-28px_rgba(217,119,6,0.45)]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
            Cargando usuarios...
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-blue-200/70 bg-linear-to-br from-blue-50 via-white to-cyan-50 p-5 shadow-[0_18px_60px_-40px_rgba(37,99,235,0.45)] backdrop-blur">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-700">
                    Total usuarios
                  </p>
                  <Users className="h-5 w-5 text-blue-600" />
                </div>
                <p className="mt-3 text-4xl font-bold text-slate-900">
                  {stats.total}
                </p>
                <p className="mt-2 text-xs text-slate-600">
                  Cuentas registradas
                </p>
              </div>
              <div className="rounded-3xl border border-emerald-200/70 bg-linear-to-br from-emerald-50 via-white to-lime-50 p-5 shadow-[0_18px_60px_-40px_rgba(5,150,105,0.45)] backdrop-blur">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
                    Usuarios activos
                  </p>
                  <UserCheck className="h-5 w-5 text-emerald-600" />
                </div>
                <p className="mt-3 text-4xl font-bold text-slate-900">
                  {stats.active}
                </p>
                <p className="mt-2 text-xs text-slate-600">
                  Con acceso habilitado
                </p>
              </div>
              <div className="rounded-3xl border border-violet-200/70 bg-linear-to-br from-violet-50 via-white to-indigo-50 p-5 shadow-[0_18px_60px_-40px_rgba(109,40,217,0.4)] backdrop-blur">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-700">
                    Administradores
                  </p>
                  <ShieldCheck className="h-5 w-5 text-violet-600" />
                </div>
                <p className="mt-3 text-4xl font-bold text-slate-900">
                  {stats.admins}
                </p>
                <p className="mt-2 text-xs text-slate-600">
                  Roles con permisos totales
                </p>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Usuarios
                  </h2>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                    {sortedUsers.length} registrados
                  </span>
                </div>
                <div className="mt-5 overflow-auto">
                  <table className="w-full text-sm text-slate-700">
                    <thead className="sticky top-0 z-10 bg-white">
                      <tr className="text-left text-xs uppercase tracking-[0.14em] text-slate-500">
                        <th className="py-2 pr-3">Usuario</th>
                        <th className="py-2 pr-3">Rol</th>
                        <th className="py-2 pr-3">Sede</th>
                        <th className="py-2 pr-3">Lineas</th>
                        <th className="py-2 pr-3">Secciones</th>
                        <th className="py-2 pr-3">Especial</th>
                        <th className="py-2 pr-3">Estado</th>
                        <th className="py-2">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedUsers.map((user, index) => (
                        <tr
                          key={user.id}
                          className={`border-t border-slate-100 transition-colors hover:bg-slate-50/80 ${
                            index % 2 === 0 ? "bg-white" : "bg-slate-50/35"
                          }`}
                        >
                          <td className="py-3 pr-3 font-semibold text-slate-900">
                            {user.username}
                          </td>
                          <td className="py-3 pr-3">
                            <span
                              className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${
                                user.role === "admin"
                                  ? "border-violet-200 bg-violet-50 text-violet-700"
                                  : "border-slate-200 bg-white text-slate-600"
                              }`}
                            >
                              {user.role}
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-xs font-semibold text-slate-700">
                            {user.role === "admin"
                              ? "-"
                              : formatAllowedSedes(
                                  user.allowedSedes,
                                  user.sede ?? inferSedeFromUsername(user.username),
                                )}
                          </td>
                          <td className="py-3 pr-3 text-xs font-semibold text-slate-700">
                            {user.role === "admin" ? "-" : formatAllowedLines(user.allowedLines)}
                          </td>
                          <td className="py-3 pr-3 text-xs font-semibold text-slate-700">
                            {user.role === "admin"
                              ? "-"
                              : formatAllowedDashboards(user.allowedDashboards)}
                          </td>
                          <td className="py-3 pr-3 text-xs font-semibold text-slate-700">
                            {user.role === "admin"
                              ? "-"
                              : (user.specialRoles && user.specialRoles.length > 0
                                ? user.specialRoles.join(", ")
                                : "-")}
                          </td>
                          <td className="py-3 pr-3">
                            <span
                              className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs font-semibold ${
                                user.is_active
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-rose-50 text-rose-700"
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
                          <td className="py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => openEdit(user)}
                                className="inline-flex items-center gap-1 rounded-full border border-mercamio-200/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-mercamio-700 transition-colors hover:bg-mercamio-50"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(user.id)}
                                className="inline-flex items-center gap-1 rounded-full border border-rose-200/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-rose-700 transition-colors hover:bg-rose-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Borrar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sortedUsers.length === 0 && (
                    <div className="py-10 text-center text-sm text-slate-500">
                      No hay usuarios registrados todavía.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                    <Clock3 className="h-4 w-4" />
                    Accesos recientes
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                      Últimos {logs.length}
                    </span>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={handleClearLogs}
                        className="rounded-full border border-rose-200/70 bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-rose-700 transition-colors hover:bg-rose-100"
                      >
                        Borrar accesos
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-5 space-y-3 text-sm text-slate-700">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/85 px-3 py-3 transition-all hover:border-slate-200 hover:bg-white"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-xs font-semibold uppercase text-slate-600 shadow-sm">
                          {log.username.slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">
                            {log.username}
                          </div>
                          <div
                            className="text-xs text-slate-500"
                            title={new Date(log.logged_at).toLocaleString("es-CO")}
                          >
                            {formatRelativeTime(log.logged_at)} • {log.ip ?? "Origen auditado desconocido"}
                          </div>
                        </div>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                        Login
                      </span>
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <p className="text-sm text-slate-500">
                      Sin accesos registrados.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_35px_90px_-45px_rgba(15,23,42,0.6)]">
            <div className="border-b border-slate-200/70 bg-linear-to-r from-slate-50 to-blue-50/45 px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                Administración
              </p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">
                {formState.id ? "Editar usuario" : "Nuevo usuario"}
              </h2>
            </div>

            <div className="space-y-4 p-6">
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
                        allowedSedes: e.target.value === "admin" ? [] : prev.allowedSedes,
                        specialRoles: e.target.value === "admin" ? [] : prev.specialRoles,
                      }))
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="user">Usuario</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>

                <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                  Sedes permitidas {formState.role === "user" ? "(obligatoria: 1 o más)" : "(solo user)"}
                  <div className="mt-1.5 grid max-h-28 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 shadow-sm sm:grid-cols-3">
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
                                    allowedSedes: prev.allowedSedes.filter((id) => id !== sede),
                                  };
                                }
                                return {
                                  ...prev,
                                  allowedSedes: [...prev.allowedSedes, sede],
                                };
                              })
                            }
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-200 disabled:cursor-not-allowed"
                          />
                          <span>{sede}</span>
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
                  <div className="mt-1.5 grid max-h-28 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 shadow-sm sm:grid-cols-3">
                    {SECTION_OPTIONS.map((section) => {
                      const checked = formState.allowedDashboards.includes(section.id);
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
                                  ? prev.allowedDashboards.filter((id) => id !== section.id)
                                  : [...prev.allowedDashboards, section.id],
                              }))
                            }
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-200 disabled:cursor-not-allowed"
                          />
                          <span>{section.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </label>

                <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                  Roles especiales
                  <div className="mt-1.5 grid max-h-20 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 shadow-sm sm:grid-cols-3">
                    {SPECIAL_ROLE_OPTIONS.map((role) => {
                      const checked = formState.specialRoles.includes(role.id);
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
                                  ? prev.specialRoles.filter((id) => id !== role.id)
                                  : [...prev.specialRoles, role.id],
                              }))
                            }
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-200 disabled:cursor-not-allowed"
                          />
                          <span>{role.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </label>

                <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                  Lineas permitidas (vacío = todas)
                  <div className="mt-1.5 grid max-h-32 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 shadow-sm sm:grid-cols-3">
                    {DEFAULT_LINES.map((line) => {
                      const checked = formState.allowedLines.includes(line.id);
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
                                  ? prev.allowedLines.filter((id) => id !== line.id)
                                  : [...prev.allowedLines, line.id],
                              }))
                            }
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-200 disabled:cursor-not-allowed"
                          />
                          <span>{line.name}</span>
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

            <div className="flex justify-end gap-2 border-t border-slate-200/70 bg-slate-50/60 px-6 py-4">
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
                className="rounded-full border border-blue-300/80 bg-blue-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-[0_10px_24px_-14px_rgba(37,99,235,0.65)] transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
