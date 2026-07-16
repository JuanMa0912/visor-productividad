"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BarChart3,
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
import { BRANCH_LOCATIONS, DEFAULT_LINES } from "@/lib/shared/constants";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { useDomInputSync } from "@/hooks/use-dom-input-sync";
import {
  PORTAL_SECTION_LABEL_BY_ID,
  PORTAL_SECTIONS,
  resolvePortalSubsectionId,
  resolvePortalSectionId,
} from "@/lib/shared/portal-sections";
import type { PortalProfileId } from "@/lib/auth/types";
import {
  getPortalProfileLabel,
  inferPortalProfileFromStoredPermissions,
  materializePortalProfilePermissions,
  PORTAL_PROFILE_OPTIONS,
  portalPermissionsToFormArrays,
  portalProfileRequiresAssignedSedes,
  portalProfileSuggestsAllSedes,
  portalProfileUsesManualPermissions,
  portalProfileAllowsDashboardOverrides,
} from "@/lib/shared/portal-profiles";
import { normalizeKeySpaced } from "@/lib/shared/normalize";
import { canonicalizeSedeKey } from "@/lib/horarios/visible-sedes";
import { formatUserAgentLabel } from "@/lib/parse-user-agent";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { UserFormModal } from "@/app/admin/usuarios/user-form-modal";
import type { UserFormState } from "@/app/admin/usuarios/user-form-validation";

const ALL_SEDES_VALUE = "Todas";
const EXTRA_SEDES = [
  "ADM",
  "CEDI-CAVASA",
  "Panificadora",
  "Planta Desposte Mixto",
  "Planta Desprese Pollo",
  "Planta",
];
const USER_SEDE_OPTIONS = Array.from(
  new Set([ALL_SEDES_VALUE, ...BRANCH_LOCATIONS, ...EXTRA_SEDES]),
);
const USER_SEDE_OPTION_SET = new Set(USER_SEDE_OPTIONS);

const canonicalizeUserSedeOption = (sede: string): string => {
  if (sede === ALL_SEDES_VALUE) return ALL_SEDES_VALUE;
  // Mantener las 3 plantas separadas (jornada-extendida). Solo normaliza alias.
  const key = canonicalizeSedeKey(sede);
  const match = USER_SEDE_OPTIONS.find(
    (option) =>
      option !== ALL_SEDES_VALUE && canonicalizeSedeKey(option) === key,
  );
  return match ?? sede;
};

type UserRow = {
  id: string;
  username: string;
  role: "admin" | "user";
  portalProfile?: PortalProfileId | null;
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

const emptyForm: UserFormState = {
  username: "",
  portalProfile: "gerente",
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

const applyPortalProfileToForm = (
  prev: UserFormState,
  portalProfile: PortalProfileId,
): UserFormState => {
  const usesManual = portalProfileUsesManualPermissions(portalProfile);
  const usesDashboardOverrides =
    portalProfileAllowsDashboardOverrides(portalProfile);
  const materialized = materializePortalProfilePermissions(
    portalProfile,
    usesManual || usesDashboardOverrides
      ? {
          allowedDashboards: prev.allowedDashboards,
          allowedSubdashboards: prev.allowedSubdashboards,
          ...(usesManual
            ? {
                allowedLines: prev.allowedLines,
                specialRoles: prev.specialRoles,
              }
            : {}),
        }
      : {},
  );
  const formArrays = portalPermissionsToFormArrays(materialized);
  let allowedSedes = prev.allowedSedes;
  if (portalProfile === "admin") {
    allowedSedes = [];
  } else if (portalProfileRequiresAssignedSedes(portalProfile)) {
    allowedSedes = allowedSedes.filter((sede) => sede !== ALL_SEDES_VALUE);
  } else if (
    portalProfileSuggestsAllSedes(portalProfile) &&
    allowedSedes.length === 0
  ) {
    allowedSedes = [ALL_SEDES_VALUE];
  }

  return {
    ...prev,
    portalProfile,
    ...formArrays,
    allowedSedes,
  };
};

const resolveUserPortalProfile = (user: UserRow): PortalProfileId =>
  user.portalProfile ??
  inferPortalProfileFromStoredPermissions({
    role: user.role,
    allowedDashboards: user.allowedDashboards,
    allowedSubdashboards: user.allowedSubdashboards,
    allowedLines: user.allowedLines,
    specialRoles: user.specialRoles,
  });

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
  "informe-variacion": "Informe de variacion",
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
  { id: "rotacion", label: "Rotacion (compat.)" },
  { id: "comparar_horarios", label: "Comparar horarios" },
  { id: "abcd", label: "ABCD" },
  {
    id: "historial_sinventario",
    label: "Historial S.inventario (rotacion)",
  },
  {
    id: "crear_horario_predeterminado",
    label: "Crear horario predeterminado",
  },
];

type PermissionCellSummary = {
  label: string;
  title: string;
  muted: boolean;
};

const isBroadPermissionLabel = (label: string) =>
  label === "—" ||
  label === "-" ||
  label === "Todas" ||
  label === "Todos" ||
  label.startsWith("Sin ");

const summarizeLabeledList = (
  labels: string[],
  opts: { allLabel: string; emptyLabel: string; maxVisible?: number },
): PermissionCellSummary => {
  const maxVisible = opts.maxVisible ?? 1;
  if (labels.length === 0) {
    return {
      label: opts.emptyLabel,
      title: opts.emptyLabel,
      muted: true,
    };
  }
  if (labels.includes(ALL_SEDES_VALUE) || labels.includes(opts.allLabel)) {
    return {
      label: opts.allLabel,
      title: opts.allLabel,
      muted: true,
    };
  }
  const title = labels.join(", ");
  if (labels.length <= maxVisible) {
    return { label: title, title, muted: false };
  }
  const head = labels.slice(0, maxVisible).join(", ");
  return {
    label: `${head} +${labels.length - maxVisible}`,
    title,
    muted: false,
  };
};

const summarizeAllowedLines = (
  allowedLines: string[] | null,
): PermissionCellSummary => {
  if (!allowedLines || allowedLines.length === 0) {
    return { label: "Todas", title: "Todas", muted: true };
  }
  return summarizeLabeledList(
    allowedLines.map((lineId) => lineLabelById.get(lineId) ?? lineId),
    { allLabel: "Todas", emptyLabel: "Todas" },
  );
};

const summarizeAllowedDashboards = (
  allowedDashboards: string[] | null,
): PermissionCellSummary => {
  if (allowedDashboards === null) {
    return { label: "Todas", title: "Todas", muted: true };
  }
  if (allowedDashboards.length === 0) {
    return { label: "Sin secciones", title: "Sin secciones", muted: true };
  }
  return summarizeLabeledList(
    allowedDashboards.map((boardId) => {
      const normalizedBoardId = resolvePortalSectionId(boardId);
      return normalizedBoardId
        ? (PORTAL_SECTION_LABEL_BY_ID.get(normalizedBoardId) ?? boardId)
        : boardId;
    }),
    { allLabel: "Todas", emptyLabel: "Sin secciones" },
  );
};

const summarizeAllowedSubdashboards = (
  allowedSubdashboards: string[] | null,
): PermissionCellSummary => {
  if (allowedSubdashboards === null) {
    return { label: "Todos", title: "Todos", muted: true };
  }
  if (allowedSubdashboards.length === 0) {
    return { label: "Sin subtableros", title: "Sin subtableros", muted: true };
  }
  return summarizeLabeledList(
    allowedSubdashboards.map((subId) => {
      const normalizedSubId = resolvePortalSubsectionId(subId);
      return normalizedSubId
        ? (SUBSECTION_LABELS[normalizedSubId] ?? subId)
        : subId;
    }),
    { allLabel: "Todos", emptyLabel: "Sin subtableros" },
  );
};

const summarizeAllowedSedes = (
  allowedSedes: string[] | null,
  fallbackSede: string | null,
): PermissionCellSummary => {
  if (allowedSedes && allowedSedes.length > 0) {
    return summarizeLabeledList(
      Array.from(
        new Set(allowedSedes.map((sede) => canonicalizeUserSedeOption(sede))),
      ),
      { allLabel: ALL_SEDES_VALUE, emptyLabel: "—", maxVisible: 1 },
    );
  }
  if (fallbackSede) {
    const label = canonicalizeUserSedeOption(fallbackSede);
    return {
      label,
      title: label,
      muted: isBroadPermissionLabel(label),
    };
  }
  return { label: "—", title: "—", muted: true };
};

const PermissionSummaryCell = ({
  summary,
  className,
}: {
  summary: PermissionCellSummary;
  className?: string;
}) => (
  <td className={className}>
    <span
      title={summary.title}
      className={`block max-w-full truncate text-xs ${
        summary.muted ? "text-slate-400" : "font-medium text-slate-700"
      }`}
    >
      {summary.label}
    </span>
  </td>
);

const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  if (!value) return null;
  return decodeURIComponent(value.split("=").slice(1).join("="));
};

const PRESENCE_REFRESH_MS = 20_000;
const PRESENCE_TICK_MS = 30_000;
const PRESENCE_ACTIVE_MAX_MS = 10 * 60_000;
const PRESENCE_AWAY_MAX_MS = 30 * 60_000;

type PresenceState = "active" | "away" | "offline" | "disabled";

type PresenceBadge = {
  state: PresenceState;
  label: string;
  dotClass: string;
  textClass: string;
  tooltip: string;
};

const buildPresenceTooltip = (lastActivityAt: string | null) => {
  if (!lastActivityAt) return "Sin sesion activa";
  const eventTime = new Date(lastActivityAt).getTime();
  if (!Number.isFinite(eventTime)) return "Sin sesion activa";
  return `Ultima actividad ${formatRelativeTime(lastActivityAt)}`;
};

const getPresenceBadge = (
  user: { is_active: boolean },
  lastActivityAt: string | null,
  nowMs: number,
): PresenceBadge => {
  if (!user.is_active) {
    return {
      state: "disabled",
      label: "Desactivado",
      dotClass: "bg-rose-500",
      textClass: "text-rose-600",
      tooltip: "Cuenta desactivada por el administrador",
    };
  }
  if (!lastActivityAt) {
    return {
      state: "offline",
      label: "Desconectado",
      dotClass: "bg-slate-400",
      textClass: "text-slate-500",
      tooltip: "Sin sesion activa",
    };
  }
  const eventTime = new Date(lastActivityAt).getTime();
  if (!Number.isFinite(eventTime)) {
    return {
      state: "offline",
      label: "Desconectado",
      dotClass: "bg-slate-400",
      textClass: "text-slate-500",
      tooltip: "Sin sesion activa",
    };
  }
  const elapsed = Math.max(0, nowMs - eventTime);
  if (elapsed <= PRESENCE_ACTIVE_MAX_MS) {
    return {
      state: "active",
      label: "Activo",
      dotClass: "bg-emerald-500",
      textClass: "text-emerald-600",
      tooltip: buildPresenceTooltip(lastActivityAt),
    };
  }
  if (elapsed <= PRESENCE_AWAY_MAX_MS) {
    return {
      state: "away",
      label: "Ausente",
      dotClass: "bg-amber-400",
      textClass: "text-amber-600",
      tooltip: buildPresenceTooltip(lastActivityAt),
    };
  }
  return {
    state: "offline",
    label: "Desconectado",
    dotClass: "bg-slate-400",
    textClass: "text-slate-500",
    tooltip: buildPresenceTooltip(lastActivityAt),
  };
};

export default function AdminUsuariosPage() {
  const router = useRouter();
  const { status: authStatus } = useRequireAuth();
  const { isAdmin } = usePermissions();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [formState, setFormState] = useState<UserFormState>(emptyForm);
  const setPasswordValue = useCallback(
    (value: React.SetStateAction<string>) => {
      setFormState((prev) => ({
        ...prev,
        password: typeof value === "function" ? value(prev.password) : value,
      }));
    },
    [],
  );
  const passwordInputRef = useDomInputSync(setPasswordValue);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [presenceFilter, setPresenceFilter] = useState<"all" | PresenceState>(
    "all",
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [usersPage, setUsersPage] = useState(1);
  const [presenceByUserId, setPresenceByUserId] = useState<Record<
    string,
    string
  > | null>(null);
  const [presenceNow, setPresenceNow] = useState<number>(() => Date.now());

  const getCsrfToken = () => getCookieValue("vp_csrf");

  const requireCsrfToken = () => {
    const token = getCsrfToken();
    if (!token) {
      toast.error("No se pudo validar la sesión. Recarga la página.");
      return null;
    }
    return token;
  };

  const handleAuthFailure = useCallback(
    (status: number) => {
      if (status === 401) {
        toast.error("Tu sesión expiró. Inicia sesión de nuevo para continuar.");
        router.replace("/login");
        return true;
      }
      if (status === 403) {
        toast.error(
          "Tu usuario no tiene permisos de administración en este momento.",
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
    return users.filter((u) => new Date(u.created_at).getTime() >= start)
      .length;
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
    if (presenceFilter !== "all" && presenceByUserId !== null) {
      list = list.filter(
        (u) =>
          getPresenceBadge(u, presenceByUserId[u.id] ?? null, presenceNow)
            .state === presenceFilter,
      );
    }
    return list;
  }, [
    sortedUsers,
    searchQuery,
    roleFilter,
    presenceFilter,
    presenceByUserId,
    presenceNow,
  ]);

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
  }, [searchQuery, roleFilter, presenceFilter]);

  useEffect(() => {
    if (usersPage > usersTotalPages) {
      setUsersPage(usersTotalPages);
    }
  }, [usersPage, usersTotalPages]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
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
      toast.error(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }, [handleAuthFailure]);

  useEffect(() => {
    // Esperamos a que el AuthProvider confirme la sesion. Si el usuario no es
    // admin, lo enviamos al hub de secciones. Si lo es, disparamos la carga.
    if (authStatus !== "authenticated") return;
    if (!isAdmin) {
      router.replace("/secciones");
      return;
    }
    void loadData();
  }, [authStatus, isAdmin, loadData, router]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    const fetchPresence = async () => {
      try {
        const response = await fetch("/api/admin/user-presence", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          presence?: Array<{ userId: string; lastActivityAt: string }>;
        };
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const entry of payload.presence ?? []) {
          if (entry?.userId && entry.lastActivityAt) {
            next[entry.userId] = entry.lastActivityAt;
          }
        }
        setPresenceByUserId(next);
        setPresenceNow(Date.now());
      } catch {
        // ignore - retry next tick
      }
    };

    void fetchPresence();
    const intervalId = window.setInterval(fetchPresence, PRESENCE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const tickId = window.setInterval(() => {
      setPresenceNow(Date.now());
    }, PRESENCE_TICK_MS);
    return () => window.clearInterval(tickId);
  }, [isAdmin]);

  const openCreate = () => {
    setFormState(applyPortalProfileToForm(emptyForm, emptyForm.portalProfile));
    setFormOpen(true);
  };

  const openEdit = (user: UserRow) => {
    const portalProfile = resolveUserPortalProfile(user);
    const allowedSedesRaw = user.allowedSedes ?? (user.sede ? [user.sede] : []);
    const allowedSedes = Array.from(
      new Set(
        allowedSedesRaw
          .map((sede) => canonicalizeUserSedeOption(sede))
          .filter((sede) => USER_SEDE_OPTION_SET.has(sede)),
      ),
    );
    const materialized = materializePortalProfilePermissions(
      portalProfile,
      portalProfileUsesManualPermissions(portalProfile) ||
        portalProfileAllowsDashboardOverrides(portalProfile)
        ? {
            allowedDashboards: user.allowedDashboards ?? [],
            allowedSubdashboards: user.allowedSubdashboards ?? [],
            ...(portalProfileUsesManualPermissions(portalProfile)
              ? {
                  allowedLines: user.allowedLines ?? [],
                  specialRoles: user.specialRoles ?? [],
                }
              : {}),
          }
        : {},
    );
    const formArrays = portalPermissionsToFormArrays(materialized);
    setFormState({
      id: user.id,
      username: user.username,
      portalProfile,
      sede:
        user.sede && allowedSedes.includes(user.sede)
          ? user.sede
          : (allowedSedes[0] ?? inferSedeFromUsername(user.username) ?? ""),
      allowedSedes,
      ...formArrays,
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
    const isUpdate = Boolean(formState.id);
    try {
      const csrfToken = requireCsrfToken();
      if (!csrfToken) {
        setSaving(false);
        return;
      }

      if (
        formState.portalProfile !== "admin" &&
        formState.allowedSedes.length === 0
      ) {
        throw new Error(
          "Debes seleccionar al menos una sede para este perfil.",
        );
      }

      const trimmedPassword = formState.password.trim();
      if (trimmedPassword.length > 0 && trimmedPassword.length < 8) {
        throw new Error("La contrasena debe tener minimo 8 caracteres.");
      }
      const payload: Record<string, unknown> = {
        username: formState.username.trim(),
        portalProfile: formState.portalProfile,
        role: formState.role,
        sede:
          formState.portalProfile === "admin"
            ? null
            : (formState.allowedSedes[0] ??
              (formState.sede.trim() ? formState.sede.trim() : null)),
        allowedSedes:
          formState.portalProfile === "admin"
            ? null
            : formState.allowedSedes.length > 0
              ? formState.allowedSedes
              : null,
        allowedLines:
          formState.portalProfile === "admin"
            ? null
            : formState.allowedLines.length > 0
              ? formState.allowedLines
              : null,
        allowedDashboards:
          formState.portalProfile === "admin"
            ? null
            : formState.allowedDashboards.length > 0
              ? formState.allowedDashboards
              : null,
        allowedSubdashboards:
          formState.portalProfile === "admin"
            ? null
            : formState.allowedSubdashboards.length > 0
              ? formState.allowedSubdashboards
              : null,
        specialRoles:
          formState.portalProfile === "admin"
            ? null
            : formState.specialRoles.length > 0
              ? formState.specialRoles
              : null,
        is_active: formState.is_active,
      };
      if (trimmedPassword.length > 0) {
        payload.password = trimmedPassword;
      }

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
      const savedUsername = formState.username.trim();
      toast.success(
        isUpdate
          ? `Usuario «${savedUsername}» actualizado correctamente.`
          : `Usuario «${savedUsername}» creado correctamente.`,
      );
      void loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("¿Seguro que deseas eliminar este usuario?")) return;
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
      toast.error(data.error ?? "No se pudo eliminar el usuario.");
      return;
    }
    await loadData();
    toast.success("Usuario eliminado correctamente.");
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
    if (
      !confirm(
        "¿Borrar TODO el historial de accesos? Esta acción no se puede deshacer.",
      )
    ) {
      return;
    }
    if (
      !confirm(
        "Confirma de nuevo: se eliminarán todos los registros de login del portal.",
      )
    ) {
      return;
    }
    const csrfToken = requireCsrfToken();
    if (!csrfToken) return;
    const response = await fetch("/api/admin/login-logs", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ confirmAll: true }),
    });
    if (handleAuthFailure(response.status)) {
      return;
    }
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      toast.error(data.error ?? "No se pudieron borrar los accesos.");
      return;
    }
    await loadData();
    toast.success("Accesos recientes borrados.");
  };

  const isAdminProfile = formState.portalProfile === "admin";
  const canEditManualPermissions = portalProfileUsesManualPermissions(
    formState.portalProfile,
  );
  const canEditDashboardPermissions = portalProfileAllowsDashboardOverrides(
    formState.portalProfile,
  );
  const dashboardPermissionsOnly = formState.portalProfile === "asadero";
  const selectedProfileSummary =
    PORTAL_PROFILE_OPTIONS.find(
      (option) => option.id === formState.portalProfile,
    )?.summary ?? "";

  return (
    <div className="min-h-screen bg-[#f7f7f8] text-slate-900">
      <AppTopBar showBack={false} />
      <div className="px-4 py-8 sm:px-6 lg:px-8">
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

              <div className="grid items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
                <div className="self-start overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
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
                          filtersOpen ||
                          roleFilter !== "all" ||
                          presenceFilter !== "all"
                            ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <Filter className="h-4 w-4" />
                        Filtros
                        {(roleFilter !== "all" || presenceFilter !== "all") && (
                          <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold text-white">
                            {(roleFilter !== "all" ? 1 : 0) +
                              (presenceFilter !== "all" ? 1 : 0)}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                  {filtersOpen && (
                    <div className="space-y-2 border-b border-slate-100 bg-slate-50/50 px-4 py-3 sm:px-5">
                      <div className="flex flex-wrap items-center gap-2">
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
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mr-1 text-xs font-medium text-slate-500">
                          Estado:
                        </span>
                        {(
                          [
                            ["all", "Todos", null, null],
                            [
                              "active",
                              "Activos",
                              "bg-emerald-500",
                              "text-emerald-700",
                            ],
                            [
                              "away",
                              "Ausentes",
                              "bg-amber-400",
                              "text-amber-700",
                            ],
                            [
                              "offline",
                              "Desconectados",
                              "bg-slate-400",
                              "text-slate-600",
                            ],
                            [
                              "disabled",
                              "Desactivados",
                              "bg-rose-500",
                              "text-rose-700",
                            ],
                          ] as const
                        ).map(([value, label, dotClass, textClass]) => {
                          const isSelected = presenceFilter === value;
                          const count =
                            value === "all"
                              ? null
                              : presenceByUserId === null
                                ? null
                                : users.filter(
                                    (u) =>
                                      getPresenceBadge(
                                        u,
                                        presenceByUserId[u.id] ?? null,
                                        presenceNow,
                                      ).state === value,
                                  ).length;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setPresenceFilter(value)}
                              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                                isSelected
                                  ? "bg-indigo-600 text-white shadow-sm"
                                  : `bg-white ring-1 ring-slate-200 hover:bg-slate-50 ${
                                      textClass ?? "text-slate-600"
                                    }`
                              }`}
                            >
                              {dotClass && (
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    isSelected ? "bg-white" : dotClass
                                  }`}
                                />
                              )}
                              {label}
                              {count !== null && (
                                <span
                                  className={`ml-0.5 rounded-full px-1.5 text-[10px] font-bold ${
                                    isSelected
                                      ? "bg-white/25 text-white"
                                      : "bg-slate-100 text-slate-600"
                                  }`}
                                >
                                  {count}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
                      <thead>
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                          <th className="sticky left-0 z-20 border-b border-slate-100 bg-slate-50 px-4 py-3 shadow-[1px_0_0_0_rgba(226,232,240,1)]">
                            Usuario
                          </th>
                          <th className="border-b border-slate-100 bg-slate-50/80 px-3 py-3">
                            Perfil
                          </th>
                          <th className="border-b border-slate-100 bg-slate-50/80 px-3 py-3">
                            Sede
                          </th>
                          <th className="border-b border-slate-100 bg-slate-50/80 px-3 py-3">
                            Líneas
                          </th>
                          <th className="border-b border-slate-100 bg-slate-50/80 px-3 py-3">
                            Secciones
                          </th>
                          <th className="border-b border-slate-100 bg-slate-50/80 px-3 py-3">
                            Subtableros
                          </th>
                          <th className="border-b border-slate-100 bg-slate-50/80 px-3 py-3">
                            Especial
                          </th>
                          <th className="border-b border-slate-100 bg-slate-50/80 px-3 py-3">
                            Estado
                          </th>
                          <th className="sticky right-0 z-20 border-b border-slate-100 bg-slate-50 px-4 py-3 text-right shadow-[-1px_0_0_0_rgba(226,232,240,1)]">
                            Acciones
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedTableUsers.map((user, index) => {
                          const palette =
                            AVATAR_STYLES[index % AVATAR_STYLES.length]!;
                          const emptySummary = {
                            label: "—",
                            title: "—",
                            muted: true,
                          } satisfies PermissionCellSummary;
                          const sedesSummary =
                            user.role === "admin"
                              ? emptySummary
                              : summarizeAllowedSedes(
                                  user.allowedSedes,
                                  user.sede ??
                                    inferSedeFromUsername(user.username),
                                );
                          const linesSummary =
                            user.role === "admin"
                              ? emptySummary
                              : summarizeAllowedLines(user.allowedLines);
                          const dashboardsSummary =
                            user.role === "admin"
                              ? emptySummary
                              : summarizeAllowedDashboards(
                                  user.allowedDashboards,
                                );
                          const subdashboardsSummary =
                            user.role === "admin"
                              ? emptySummary
                              : summarizeAllowedSubdashboards(
                                  user.allowedSubdashboards,
                                );
                          const specialRoles =
                            user.role === "admin"
                              ? []
                              : (user.specialRoles ?? []);
                          const specialTitle = specialRoles.join(", ");
                          return (
                            <tr
                              key={user.id}
                              className="group transition-colors hover:bg-slate-50/90"
                            >
                              <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-2.5 shadow-[1px_0_0_0_rgba(226,232,240,1)] group-hover:bg-slate-50">
                                <div className="flex min-w-42 items-center gap-3">
                                  <div
                                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${palette.bg} ${palette.text}`}
                                  >
                                    {userInitials(user.username)}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate font-semibold text-slate-900">
                                      {user.username}
                                    </div>
                                    <div className="truncate text-[11px] text-slate-400">
                                      {user.username}@portal
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2.5">
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                                    user.role === "admin"
                                      ? "border-indigo-100 bg-indigo-50 text-indigo-800"
                                      : "border-slate-200 bg-slate-50 text-slate-600"
                                  }`}
                                >
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      user.role === "admin"
                                        ? "bg-indigo-500"
                                        : "bg-slate-400"
                                    }`}
                                  />
                                  {getPortalProfileLabel(
                                    resolveUserPortalProfile(user),
                                  )}
                                </span>
                              </td>
                              <PermissionSummaryCell
                                summary={sedesSummary}
                                className="max-w-36 border-b border-slate-100 px-3 py-2.5"
                              />
                              <PermissionSummaryCell
                                summary={linesSummary}
                                className="max-w-28 border-b border-slate-100 px-3 py-2.5"
                              />
                              <PermissionSummaryCell
                                summary={dashboardsSummary}
                                className="max-w-32 border-b border-slate-100 px-3 py-2.5"
                              />
                              <PermissionSummaryCell
                                summary={subdashboardsSummary}
                                className="max-w-40 border-b border-slate-100 px-3 py-2.5"
                              />
                              <td className="max-w-36 border-b border-slate-100 px-3 py-2.5">
                                {user.role === "admin" ? (
                                  <span className="text-xs text-slate-400">
                                    —
                                  </span>
                                ) : specialRoles.length === 0 ? (
                                  <span className="text-xs text-slate-400">
                                    —
                                  </span>
                                ) : (
                                  <div
                                    className="flex max-w-full items-center gap-1 overflow-hidden"
                                    title={specialTitle}
                                  >
                                    <span className="truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                                      {specialRoles[0]}
                                    </span>
                                    {specialRoles.length > 1 ? (
                                      <span className="shrink-0 rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                        +{specialRoles.length - 1}
                                      </span>
                                    ) : null}
                                  </div>
                                )}
                              </td>
                              <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2.5">
                                {presenceByUserId === null ? (
                                  <span
                                    title="Cargando estado..."
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400"
                                  >
                                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-300" />
                                    Cargando
                                  </span>
                                ) : (
                                  (() => {
                                    const badge = getPresenceBadge(
                                      user,
                                      presenceByUserId[user.id] ?? null,
                                      presenceNow,
                                    );
                                    return (
                                      <span
                                        title={badge.tooltip}
                                        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${badge.textClass}`}
                                      >
                                        <span
                                          className={`h-2 w-2 shrink-0 rounded-full ${badge.dotClass} ${
                                            badge.state === "active"
                                              ? "animate-pulse"
                                              : ""
                                          }`}
                                        />
                                        {badge.label}
                                      </span>
                                    );
                                  })()
                                )}
                              </td>
                              <td className="sticky right-0 z-10 border-b border-slate-100 bg-white px-4 py-2.5 text-right shadow-[-1px_0_0_0_rgba(226,232,240,1)] group-hover:bg-slate-50">
                                <div className="inline-flex gap-1">
                                  <Link
                                    href={`/admin/usuarios/${user.id}/metricas`}
                                    className="rounded-lg p-1.5 text-emerald-600 transition hover:bg-emerald-50"
                                    title="Ver métricas de uso"
                                  >
                                    <BarChart3 className="h-4 w-4" />
                                  </Link>
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
                          Mostrando {(usersPage - 1) * USERS_PAGE_SIZE + 1} a{" "}
                          {Math.min(
                            usersPage * USERS_PAGE_SIZE,
                            filteredTableUsers.length,
                          )}{" "}
                          de {filteredTableUsers.length} usuarios
                          {searchQuery.trim() ||
                          roleFilter !== "all" ||
                          presenceFilter !== "all"
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

                <aside className="flex h-full min-h-0 flex-col rounded-xl border border-slate-100 bg-white shadow-sm">
                  <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-100 p-4 sm:p-5">
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
                  <div className="relative min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                    <div className="pointer-events-none absolute bottom-6 left-[1.35rem] top-8 w-px bg-slate-200" />
                    <ul className="relative space-y-0">
                      {logs.map((log, logIndex) => {
                        const lp =
                          AVATAR_STYLES[logIndex % AVATAR_STYLES.length]!;
                        return (
                          <li
                            key={log.id}
                            className="relative pb-5 pl-10 last:pb-0"
                          >
                            <div
                              className={`absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold ${lp.bg} ${lp.text} ring-4 ring-white`}
                            >
                              {userInitials(log.username)}
                            </div>
                            <div
                              className={`rounded-lg border p-2.5 ${
                                logIndex === 0
                                  ? "border-indigo-200 bg-indigo-50/60"
                                  : "border-slate-100 bg-slate-50/80"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <Link
                                  href={`/admin/usuarios/${log.user_id}/metricas`}
                                  className="truncate font-semibold text-slate-900 transition hover:text-indigo-700 hover:underline"
                                >
                                  {log.username}
                                </Link>
                                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                  Login
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatRelativeTime(log.logged_at)}
                              </p>
                              <p className="mt-0.5 text-[11px] text-slate-400">
                                {log.ip ?? "Origen auditado desconocido"}
                              </p>
                              <p
                                className="mt-0.5 truncate text-[11px] text-slate-500"
                                title={log.user_agent ?? undefined}
                              >
                                {formatUserAgentLabel(log.user_agent)}
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
                  <div className="mt-auto shrink-0 space-y-2 border-t border-slate-100 p-4">
                    <Link
                      href="/admin/usuarios/accesos"
                      className="inline-flex items-center gap-1 text-sm font-medium text-sky-600 transition hover:text-sky-700 hover:underline"
                    >
                      Ver registro completo
                      <span aria-hidden>→</span>
                    </Link>
                    <Link
                      href="/admin/usuarios/uso-tableros"
                      className="block text-sm font-medium text-violet-700 transition hover:text-violet-800 hover:underline"
                    >
                      Uso de tableros
                    </Link>
                    <Link
                      href="/admin/usuarios/auditoria"
                      className="block text-sm font-medium text-rose-700 transition hover:text-rose-800 hover:underline"
                    >
                      Auditoría
                    </Link>
                  </div>
                </aside>
              </div>
            </>
          )}
        </div>

        <UserFormModal
          open={formOpen}
          formState={formState}
          setFormState={setFormState}
          onClose={closeForm}
          onSave={handleSave}
          saving={saving}
          isAdminProfile={isAdminProfile}
          canEditManualPermissions={canEditManualPermissions}
          canEditDashboardPermissions={canEditDashboardPermissions}
          dashboardPermissionsOnly={dashboardPermissionsOnly}
          selectedProfileSummary={selectedProfileSummary}
          sedeOptions={USER_SEDE_OPTIONS}
          sectionOptions={SECTION_OPTIONS}
          subsectionLabels={SUBSECTION_LABELS}
          specialRoleOptions={SPECIAL_ROLE_OPTIONS}
          passwordInputRef={passwordInputRef}
          onPortalProfileChange={(portalProfile) =>
            setFormState((prev) =>
              applyPortalProfileToForm(prev, portalProfile),
            )
          }
        />
      </div>
    </div>
  );
}
