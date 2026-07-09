import type { AuthRole, PortalProfileId } from "@/lib/auth/types";
import type { PortalSectionId, PortalSubsectionId } from "@/lib/shared/portal-sections";
import {
  normalizeAllowedPortalSections,
  normalizeAllowedPortalSubsections,
  PORTAL_SUBSECTIONS_BY_SECTION,
} from "@/lib/shared/portal-sections";
import { ASADERO_LINE_ID } from "@/lib/shared/line-category-scope";

export type { PortalProfileId };

export const PORTAL_PROFILE_IDS: PortalProfileId[] = [
  "admin",
  "subadmin",
  "gerente",
  "director_comercial",
  "asadero",
  "rrhh",
  "personalizado",
];

export const PORTAL_PROFILE_OPTIONS: Array<{
  id: PortalProfileId;
  label: string;
  summary: string;
}> = [
  {
    id: "admin",
    label: "Admin",
    summary:
      "Todos los tableros, cronograma, administración de usuarios y rotación v4. Todas las sedes y líneas.",
  },
  {
    id: "subadmin",
    label: "Subadmin",
    summary:
      "Tableros de Venta, Producto y Operación con capacidades de horarios y rotación. Todas las sedes y líneas.",
  },
  {
    id: "gerente",
    label: "Gerente",
    summary:
      "Tableros de Venta, Producto y Operación con capacidades de horarios y rotación. Sedes asignadas y todas las líneas.",
  },
  {
    id: "director_comercial",
    label: "Director comercial",
    summary:
      "Igual que Subadmin en permisos. Todas las sedes y líneas.",
  },
  {
    id: "asadero",
    label: "Asadero",
    summary:
      "Márgenes, rotación, variación y operación (horas) solo con datos de Asaderos. Puedes quitar tableros; la línea sigue fija en asadero.",
  },
  {
    id: "rrhh",
    label: "RRHH",
    summary:
      "Solo tableros de Operación y capacidades de horarios. Todas o varias sedes.",
  },
  {
    id: "personalizado",
    label: "Personalizado",
    summary:
      "Permisos elegidos manualmente: tableros, capacidades, sedes y líneas.",
  },
];

const OPERACION_SECTIONS: PortalSectionId[] = ["operacion"];

const OPERACION_SUBSECTIONS: PortalSubsectionId[] = [
  ...PORTAL_SUBSECTIONS_BY_SECTION.operacion,
];

const ASADERO_SUBSECTIONS: PortalSubsectionId[] = [
  "mix-y-linea",
  "margenes",
  "rotacion",
  "informe-variacion",
  ...OPERACION_SUBSECTIONS,
];

const ASADERO_SECTIONS: PortalSectionId[] = ["producto", "operacion"];

export const getAsaderoDashboardOptions = () => ({
  sections: [...ASADERO_SECTIONS],
  subsections: [...ASADERO_SUBSECTIONS],
});

const COMMERCIAL_SPECIAL_ROLES = [
  "alex",
  "comparar_horarios",
  "replicar_lunes",
  "crear_horario_predeterminado",
  "abcd",
  "historial_sinventario",
] as const;

const RRHH_SPECIAL_ROLES = [
  "alex",
  "comparar_horarios",
  "replicar_lunes",
  "crear_horario_predeterminado",
] as const;

export type PortalProfileMaterializedPermissions = {
  portalProfile: PortalProfileId;
  role: AuthRole;
  allowedDashboards: PortalSectionId[] | null;
  allowedSubdashboards: PortalSubsectionId[] | null;
  allowedLines: string[] | null;
  specialRoles: string[] | null;
};

export type PortalProfilePermissionOverrides = {
  allowedSedes?: string[] | null;
  allowedLines?: string[] | null;
  allowedDashboards?: string[] | null;
  allowedSubdashboards?: string[] | null;
  specialRoles?: string[] | null;
};

const COMMERCIAL_PRESET: Omit<
  PortalProfileMaterializedPermissions,
  "portalProfile" | "role"
> = {
  allowedDashboards: null,
  allowedSubdashboards: null,
  allowedLines: null,
  specialRoles: [...COMMERCIAL_SPECIAL_ROLES],
};

const PROFILE_PRESETS: Record<
  PortalProfileId,
  PortalProfileMaterializedPermissions
> = {
  admin: {
    portalProfile: "admin",
    role: "admin",
    allowedDashboards: null,
    allowedSubdashboards: null,
    allowedLines: null,
    specialRoles: null,
  },
  subadmin: {
    portalProfile: "subadmin",
    role: "user",
    ...COMMERCIAL_PRESET,
  },
  gerente: {
    portalProfile: "gerente",
    role: "user",
    ...COMMERCIAL_PRESET,
  },
  director_comercial: {
    portalProfile: "director_comercial",
    role: "user",
    ...COMMERCIAL_PRESET,
  },
  asadero: {
    portalProfile: "asadero",
    role: "user",
    allowedDashboards: ASADERO_SECTIONS,
    allowedSubdashboards: ASADERO_SUBSECTIONS,
    allowedLines: [ASADERO_LINE_ID],
    specialRoles: [...COMMERCIAL_SPECIAL_ROLES],
  },
  rrhh: {
    portalProfile: "rrhh",
    role: "user",
    allowedDashboards: OPERACION_SECTIONS,
    allowedSubdashboards: OPERACION_SUBSECTIONS,
    allowedLines: null,
    specialRoles: [...RRHH_SPECIAL_ROLES],
  },
  personalizado: {
    portalProfile: "personalizado",
    role: "user",
    allowedDashboards: null,
    allowedSubdashboards: null,
    allowedLines: null,
    specialRoles: null,
  },
};

export const isPortalProfileId = (value: unknown): value is PortalProfileId =>
  typeof value === "string" &&
  (PORTAL_PROFILE_IDS as string[]).includes(value);

export const resolveValidPortalProfile = (
  value: unknown,
): { ok: true; value: PortalProfileId } | { ok: false; error: string } => {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: "personalizado" };
  }
  if (!isPortalProfileId(value)) {
    return { ok: false, error: "El perfil de portal no es válido." };
  }
  return { ok: true, value };
};

export const portalProfileUsesManualPermissions = (
  profileId: PortalProfileId,
): boolean => profileId === "personalizado";

/** Perfiles que permiten ajustar secciones/subtableros sin pasar a personalizado. */
export const portalProfileAllowsDashboardOverrides = (
  profileId: PortalProfileId,
): boolean => profileId === "personalizado" || profileId === "asadero";

const isSubset = <T extends string>(
  actual: T[] | null,
  allowed: T[] | null,
): boolean => {
  if (!allowed || allowed.length === 0) return true;
  if (!actual || actual.length === 0) return true;
  const allowedSet = new Set(allowed);
  return actual.every((value) => allowedSet.has(value));
};

const constrainAsaderoDashboardOverrides = (
  preset: PortalProfileMaterializedPermissions,
  overrides: PortalProfilePermissionOverrides,
): Pick<
  PortalProfileMaterializedPermissions,
  "allowedDashboards" | "allowedSubdashboards"
> => {
  const maxSections = preset.allowedDashboards ?? [];
  const maxSubsections = preset.allowedSubdashboards ?? [];

  let dashboards = normalizeAllowedPortalSections(
    emptyToNull(overrides.allowedDashboards),
  );
  let subdashboards = normalizeAllowedPortalSubsections(
    emptyToNull(overrides.allowedSubdashboards),
  );

  if (dashboards?.length) {
    dashboards = dashboards.filter((section) => maxSections.includes(section));
  }
  if (!dashboards?.length) {
    dashboards = [...maxSections];
  }

  if (subdashboards?.length) {
    subdashboards = subdashboards.filter((subsection) =>
      maxSubsections.includes(subsection),
    );
  }
  if (!subdashboards?.length) {
    subdashboards = [...maxSubsections];
  }

  return {
    allowedDashboards: dashboards,
    allowedSubdashboards: subdashboards,
  };
};

export const portalProfileRequiresAssignedSedes = (
  profileId: PortalProfileId,
): boolean => profileId === "gerente";

export const portalProfileSuggestsAllSedes = (
  profileId: PortalProfileId,
): boolean =>
  profileId === "subadmin" ||
  profileId === "director_comercial" ||
  profileId === "asadero" ||
  profileId === "rrhh";

const emptyToNull = <T>(value: T[] | null | undefined): T[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value;
};

export const getPortalProfilePreset = (
  profileId: PortalProfileId,
): PortalProfileMaterializedPermissions => ({
  ...PROFILE_PRESETS[profileId],
});

export const materializePortalProfilePermissions = (
  profileId: PortalProfileId,
  overrides: PortalProfilePermissionOverrides = {},
): PortalProfileMaterializedPermissions => {
  if (profileId === "personalizado") {
    return {
      portalProfile: "personalizado",
      role: "user",
      allowedDashboards: normalizeAllowedPortalSections(
        emptyToNull(overrides.allowedDashboards),
      ),
      allowedSubdashboards: normalizeAllowedPortalSubsections(
        emptyToNull(overrides.allowedSubdashboards),
      ),
      allowedLines: emptyToNull(overrides.allowedLines),
      specialRoles: emptyToNull(overrides.specialRoles),
    };
  }

  if (profileId === "asadero") {
    const preset = PROFILE_PRESETS.asadero;
    return {
      ...preset,
      ...constrainAsaderoDashboardOverrides(preset, overrides),
    };
  }

  return { ...PROFILE_PRESETS[profileId] };
};

export const resolveDefaultSedesForProfile = (
  profileId: PortalProfileId,
  provided?: string[] | null,
): string[] | null => {
  if (profileId === "admin") return null;
  if (Array.isArray(provided) && provided.length > 0) return provided;
  if (portalProfileSuggestsAllSedes(profileId)) return ["Todas"];
  return null;
};

export const validateSedesForPortalProfile = (
  profileId: PortalProfileId,
  allowedSedes: string[] | null,
): string | null => {
  if (profileId === "admin") return null;
  if (!allowedSedes || allowedSedes.length === 0) {
    return "Debes seleccionar al menos una sede.";
  }
  if (
    portalProfileRequiresAssignedSedes(profileId) &&
    allowedSedes.some((sede) => sede.trim().toLowerCase() === "todas")
  ) {
    return "El perfil Gerente no puede usar la sede «Todas»; asigna sedes concretas.";
  }
  return null;
};

const arraysEqual = (a: string[] | null, b: string[] | null) => {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
};

export const inferPortalProfileFromStoredPermissions = (user: {
  role: AuthRole;
  allowedDashboards?: string[] | null;
  allowedSubdashboards?: string[] | null;
  allowedLines?: string[] | null;
  specialRoles?: string[] | null;
}): PortalProfileId => {
  if (user.role === "admin") return "admin";

  for (const profileId of PORTAL_PROFILE_IDS) {
    if (profileId === "personalizado" || profileId === "admin") continue;
    const preset = PROFILE_PRESETS[profileId];
    const dashboardsMatch =
      profileId === "asadero"
        ? isSubset(
            normalizeAllowedPortalSections(user.allowedDashboards),
            preset.allowedDashboards,
          ) &&
          isSubset(
            normalizeAllowedPortalSubsections(user.allowedSubdashboards),
            preset.allowedSubdashboards,
          )
        : arraysEqual(
            normalizeAllowedPortalSections(user.allowedDashboards),
            preset.allowedDashboards,
          ) &&
          arraysEqual(
            normalizeAllowedPortalSubsections(user.allowedSubdashboards),
            preset.allowedSubdashboards,
          );
    if (
      dashboardsMatch &&
      arraysEqual(user.allowedLines ?? null, preset.allowedLines) &&
      arraysEqual(user.specialRoles ?? null, preset.specialRoles)
    ) {
      return profileId;
    }
  }

  return "personalizado";
};

/** Convierte permisos materializados a arrays vacíos para checkboxes del admin. */
export const portalPermissionsToFormArrays = (
  permissions: PortalProfileMaterializedPermissions,
) => ({
  role: permissions.role,
  allowedDashboards: permissions.allowedDashboards ?? [],
  allowedSubdashboards: permissions.allowedSubdashboards ?? [],
  allowedLines: permissions.allowedLines ?? [],
  specialRoles: permissions.specialRoles ?? [],
});

export type AdminUserPermissionInput = {
  portalProfile?: unknown;
  role?: AuthRole;
  allowedSedes?: string[] | null;
  allowedLines?: string[] | null;
  allowedDashboards?: string[] | null;
  allowedSubdashboards?: string[] | null;
  specialRoles?: string[] | null;
};

export const resolveAdminUserPermissionsFromBody = (
  body: AdminUserPermissionInput,
):
  | {
      ok: true;
      value: PortalProfileMaterializedPermissions & {
        allowedSedes: string[] | null;
      };
    }
  | { ok: false; error: string } => {
  const profileResult = resolveValidPortalProfile(
    body.portalProfile ?? (body.role === "admin" ? "admin" : undefined),
  );
  if (!profileResult.ok) {
    return profileResult;
  }

  const profileId = profileResult.value;
  const usesManual = portalProfileUsesManualPermissions(profileId);
  const usesDashboardOverrides = portalProfileAllowsDashboardOverrides(profileId);
  const materialized = materializePortalProfilePermissions(
    profileId,
    usesManual || usesDashboardOverrides
      ? {
          allowedDashboards: body.allowedDashboards,
          allowedSubdashboards: body.allowedSubdashboards,
          ...(usesManual
            ? {
                allowedLines: body.allowedLines,
                specialRoles: body.specialRoles,
              }
            : {}),
        }
      : {},
  );

  const allowedSedes = resolveDefaultSedesForProfile(
    profileId,
    body.allowedSedes,
  );
  const sedeError = validateSedesForPortalProfile(profileId, allowedSedes);
  if (sedeError) {
    return { ok: false, error: sedeError };
  }

  return {
    ok: true,
    value: {
      ...materialized,
      allowedSedes,
    },
  };
};

export const getPortalProfileLabel = (profileId: PortalProfileId | null | undefined) =>
  PORTAL_PROFILE_OPTIONS.find((option) => option.id === profileId)?.label ??
  "Personalizado";
