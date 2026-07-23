import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import {
  applySessionCookies,
  getAuditNetworkId,
  getClientIp,
  hashPassword,
  requireAdminSession,
  validatePasswordPolicy,
  verifyCsrf,
} from "@/lib/auth";
import {
  buildUserAuditSnapshot,
  insertUserAdminAudit,
} from "@/lib/admin/user-admin-audit";
import { ALLOWED_LINE_IDS, BRANCH_LOCATIONS } from "@/lib/shared/constants";
import {
  resolveValidAllowedEmpresas,
} from "@/lib/shared/data-tenant";
import {
  normalizeAllowedPortalSections,
  normalizeAllowedPortalSubsections,
  resolvePortalSectionId,
  resolvePortalSubsectionId,
} from "@/lib/shared/portal-sections";
import {
  inferPortalProfileFromStoredPermissions,
  resolveAdminUserPermissionsFromBody,
  resolveValidPortalProfile,
} from "@/lib/shared/portal-profiles";
import { checkRateLimit } from "@/lib/shared/rate-limit";

const ALL_SEDES_VALUE = "Todas";
const EXTRA_SEDES = [
  "ADM",
  "CEDI-CAVASA",
  "Panificadora",
  "Planta Desposte Mixto",
  "Planta Desprese Pollo",
];
const ALLOWED_SEDE_SET = new Set([
  ...BRANCH_LOCATIONS,
  ...EXTRA_SEDES,
  ALL_SEDES_VALUE,
]);
const ALLOWED_LINE_SET = new Set(ALLOWED_LINE_IDS);
const ALLOWED_SPECIAL_ROLE_SET = new Set([
  "alex",
  "cronograma",
  "replicar_lunes",
  "comparar_horarios",
  "abcd",
  "historial_sinventario",
  "crear_horario_predeterminado",
]);

const resolveValidSede = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return ALLOWED_SEDE_SET.has(trimmed) ? trimmed : null;
};

const hasSedeColumn = async (client: {
  query: (queryText: string) => Promise<{ rows?: unknown[] }>;
}) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'app_users'
      AND column_name = 'sede'
    LIMIT 1
    `,
  );
  return (result.rows?.length ?? 0) > 0;
};

const hasAllowedLinesColumn = async (client: {
  query: (queryText: string) => Promise<{ rows?: unknown[] }>;
}) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'app_users'
      AND column_name = 'allowed_lines'
    LIMIT 1
    `,
  );
  return (result.rows?.length ?? 0) > 0;
};

const hasAllowedDashboardsColumn = async (client: {
  query: (queryText: string) => Promise<{ rows?: unknown[] }>;
}) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'app_users'
      AND column_name = 'allowed_dashboards'
    LIMIT 1
    `,
  );
  return (result.rows?.length ?? 0) > 0;
};

const hasAllowedSubdashboardsColumn = async (client: {
  query: (queryText: string) => Promise<{ rows?: unknown[] }>;
}) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'app_users'
      AND column_name = 'allowed_subdashboards'
    LIMIT 1
    `,
  );
  return (result.rows?.length ?? 0) > 0;
};

const hasAllowedSedesColumn = async (client: {
  query: (queryText: string) => Promise<{ rows?: unknown[] }>;
}) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'app_users'
      AND column_name = 'allowed_sedes'
    LIMIT 1
    `,
  );
  return (result.rows?.length ?? 0) > 0;
};

const hasAllowedEmpresasColumn = async (client: {
  query: (queryText: string) => Promise<{ rows?: unknown[] }>;
}) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'app_users'
      AND column_name = 'allowed_empresas'
    LIMIT 1
    `,
  );
  return (result.rows?.length ?? 0) > 0;
};

const hasSpecialRolesColumn = async (client: {
  query: (queryText: string) => Promise<{ rows?: unknown[] }>;
}) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'app_users'
      AND column_name = 'special_roles'
    LIMIT 1
    `,
  );
  return (result.rows?.length ?? 0) > 0;
};

const hasPortalProfileColumn = async (client: {
  query: (queryText: string) => Promise<{ rows?: unknown[] }>;
}) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'app_users'
      AND column_name = 'portal_profile'
    LIMIT 1
    `,
  );
  return (result.rows?.length ?? 0) > 0;
};

const resolveValidAllowedLines = (value: unknown) => {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null as string[] | null };
  }
  if (!Array.isArray(value)) {
    return { ok: false as const, error: "Las lineas permitidas no son válidas." };
  }

  const normalized = Array.from(
    new Set(
      value
        .map((line) => (typeof line === "string" ? line.trim() : ""))
        .filter(Boolean),
    ),
  );
  if (normalized.length === 0) {
    return { ok: true as const, value: null as string[] | null };
  }

  const invalid = normalized.filter((line) => !ALLOWED_LINE_SET.has(line));
  if (invalid.length > 0) {
    return { ok: false as const, error: "Hay lineas no válidas en la selección." };
  }

  return { ok: true as const, value: normalized };
};

const resolveValidAllowedDashboards = (value: unknown) => {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null as string[] | null };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false as const,
      error: "Las secciones permitidas no son validas.",
    };
  }

  const hasMeaningfulEntries = value.some(
    (board) => typeof board === "string" && board.trim(),
  );
  if (!hasMeaningfulEntries) {
    return { ok: true as const, value: null as string[] | null };
  }

  const invalid = value.filter(
    (board) =>
      typeof board === "string" &&
      board.trim() &&
      !resolvePortalSectionId(board),
  );
  if (invalid.length > 0) {
    return {
      ok: false as const,
      error: "Hay secciones no validas en la seleccion.",
    };
  }

  const normalized = normalizeAllowedPortalSections(value) ?? [];
  if (normalized.length === 0) {
    return { ok: true as const, value: null as string[] | null };
  }

  return { ok: true as const, value: normalized };
};

const resolveValidAllowedSubdashboards = (value: unknown) => {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null as string[] | null };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false as const,
      error: "Los subtableros permitidos no son validos.",
    };
  }

  const hasMeaningfulEntries = value.some(
    (entry) => typeof entry === "string" && entry.trim(),
  );
  if (!hasMeaningfulEntries) {
    return { ok: true as const, value: null as string[] | null };
  }

  const invalid = value.filter(
    (entry) =>
      typeof entry === "string" &&
      entry.trim() &&
      !resolvePortalSubsectionId(entry),
  );
  if (invalid.length > 0) {
    return {
      ok: false as const,
      error: "Hay subtableros no validos en la seleccion.",
    };
  }

  const normalized = normalizeAllowedPortalSubsections(value) ?? [];
  if (normalized.length === 0) {
    return { ok: true as const, value: null as string[] | null };
  }
  return { ok: true as const, value: normalized };
};

const resolveValidAllowedSedes = (value: unknown) => {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null as string[] | null };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false as const,
      error: "Las sedes permitidas no son válidas.",
    };
  }
  const normalized = Array.from(
    new Set(
      value
        .map((sede) => (typeof sede === "string" ? sede.trim() : ""))
        .filter(Boolean),
    ),
  );
  if (normalized.length === 0) {
    return { ok: true as const, value: null as string[] | null };
  }
  const invalid = normalized.filter((sede) => !ALLOWED_SEDE_SET.has(sede));
  if (invalid.length > 0) {
    return {
      ok: false as const,
      error: "Hay sedes no válidas en la selección.",
    };
  }
  return { ok: true as const, value: normalized };
};

const resolveValidSpecialRoles = (value: unknown) => {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null as string[] | null };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false as const,
      error: "Los roles especiales no son válidos.",
    };
  }
  const normalized = Array.from(
    new Set(
      value
        .map((role) => (typeof role === "string" ? role.trim().toLowerCase() : ""))
        .filter(Boolean),
    ),
  );
  if (normalized.length === 0) {
    return { ok: true as const, value: null as string[] | null };
  }
  // Descarta ids retirados (p. ej. `rotacion` legacy) en vez de fallar el alta.
  const valid = normalized.filter((role) => ALLOWED_SPECIAL_ROLE_SET.has(role));
  return { ok: true as const, value: valid.length > 0 ? valid : null };
};

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) => applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 60,
    keyPrefix: "admin-users-get",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta más tarde." },
        { status: 429, headers: { "Retry-After": retryAfterSeconds.toString() } },
      ),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT
        u.id,
        u.username,
        u.role,
        to_jsonb(u)->>'sede' AS sede,
        to_jsonb(u)->'allowed_sedes' AS "allowedSedes",
        to_jsonb(u)->'allowed_empresas' AS "allowedEmpresas",
        to_jsonb(u)->'allowed_lines' AS "allowedLines",
        to_jsonb(u)->'allowed_dashboards' AS "allowedDashboards",
        to_jsonb(u)->'allowed_subdashboards' AS "allowedSubdashboards",
        to_jsonb(u)->'special_roles' AS "specialRoles",
        to_jsonb(u)->>'portal_profile' AS "portalProfile",
        u.is_active,
        u.created_at,
        u.updated_at,
        u.last_login_at,
        u.last_login_ip
      FROM app_users u
      ORDER BY created_at DESC
      `,
    );
    const users = (result.rows ?? []).map((row) => {
      const user = row as {
        role: "admin" | "user";
        allowedDashboards?: string[] | null;
        allowedSubdashboards?: string[] | null;
        allowedLines?: string[] | null;
        specialRoles?: string[] | null;
        portalProfile?: string | null;
      };
      const profileResult = resolveValidPortalProfile(user.portalProfile);
      const portalProfile = profileResult.ok
        ? profileResult.value
        : inferPortalProfileFromStoredPermissions({
            role: user.role,
            allowedDashboards: user.allowedDashboards,
            allowedSubdashboards: user.allowedSubdashboards,
            allowedLines: user.allowedLines,
            specialRoles: user.specialRoles,
          });
      return {
        ...user,
        portalProfile,
        allowedDashboards: normalizeAllowedPortalSections(user.allowedDashboards),
        allowedSubdashboards: normalizeAllowedPortalSubsections(
          user.allowedSubdashboards,
        ),
      };
    });
    return withSession(NextResponse.json({ users }));
  } finally {
    client.release();
  }
}

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) => applySessionCookies(response, session);

  if (!(await verifyCsrf(req))) {
    return withSession(
      NextResponse.json({ error: "CSRF inválido." }, { status: 403 }),
    );
  }

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 20,
    keyPrefix: "admin-users-post",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta más tarde." },
        { status: 429, headers: { "Retry-After": retryAfterSeconds.toString() } },
      ),
    );
  }

  const body = (await req.json()) as {
    username?: string;
    password?: string;
    role?: "admin" | "user";
    portalProfile?: string;
    sede?: string | null;
    allowedSedes?: string[] | null;
    allowedEmpresas?: string[] | null;
    allowedLines?: string[] | null;
    allowedDashboards?: string[] | null;
    allowedSubdashboards?: string[] | null;
    specialRoles?: string[] | null;
  };

  const username = body.username?.trim();
  const password = body.password ?? "";
  const permissionsResult = resolveAdminUserPermissionsFromBody(body);
  if (!permissionsResult.ok) {
    return NextResponse.json(
      { error: permissionsResult.error },
      { status: 400 },
    );
  }
  const resolved = permissionsResult.value;
  const role = resolved.role;
  const sede = resolveValidSede(body.sede);
  const allowedSedesResult = resolveValidAllowedSedes(resolved.allowedSedes);
  const allowedEmpresasResult = resolveValidAllowedEmpresas(body.allowedEmpresas);
  const allowedLinesResult = resolveValidAllowedLines(resolved.allowedLines);
  const allowedDashboardsResult = resolveValidAllowedDashboards(
    resolved.allowedDashboards,
  );
  const allowedSubdashboardsResult = resolveValidAllowedSubdashboards(
    resolved.allowedSubdashboards,
  );
  const specialRolesResult = resolveValidSpecialRoles(resolved.specialRoles);

  if (!username) {
    return NextResponse.json(
      { error: "El usuario es obligatorio." },
      { status: 400 },
    );
  }
  const passwordPolicyError = validatePasswordPolicy(password);
  if (passwordPolicyError) {
    return NextResponse.json(
      { error: passwordPolicyError },
      { status: 400 },
    );
  }
  if (role === "user" && !sede && (!allowedSedesResult.ok || !allowedSedesResult.value || allowedSedesResult.value.length === 0)) {
    return NextResponse.json(
      { error: "Los usuarios de rol user deben tener sede asignada." },
      { status: 400 },
    );
  }
  if (body.sede && !sede) {
    return NextResponse.json(
      { error: "La sede no es válida." },
      { status: 400 },
    );
  }
  if (!allowedSedesResult.ok) {
    return NextResponse.json(
      { error: allowedSedesResult.error },
      { status: 400 },
    );
  }
  if (!allowedEmpresasResult.ok) {
    return NextResponse.json(
      { error: allowedEmpresasResult.error },
      { status: 400 },
    );
  }
  if (!allowedLinesResult.ok) {
    return NextResponse.json(
      { error: allowedLinesResult.error },
      { status: 400 },
    );
  }
  if (!allowedDashboardsResult.ok) {
    return NextResponse.json(
      { error: allowedDashboardsResult.error },
      { status: 400 },
    );
  }
  if (!specialRolesResult.ok) {
    return NextResponse.json(
      { error: specialRolesResult.error },
      { status: 400 },
    );
  }
  if (!allowedSubdashboardsResult.ok) {
    return NextResponse.json(
      { error: allowedSubdashboardsResult.error },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(password);
  const client = await (await getDbPool()).connect();
  try {
    const sedeEnabled = await hasSedeColumn(client);
    const allowedSedesEnabled = await hasAllowedSedesColumn(client);
    const allowedLinesEnabled = await hasAllowedLinesColumn(client);
    const allowedDashboardsEnabled = await hasAllowedDashboardsColumn(client);
    const allowedSubdashboardsEnabled = await hasAllowedSubdashboardsColumn(client);
    const specialRolesEnabled = await hasSpecialRolesColumn(client);
    const portalProfileEnabled = await hasPortalProfileColumn(client);
    const allowedEmpresasEnabled = await hasAllowedEmpresasColumn(client);
    if (
      !allowedEmpresasEnabled &&
      body.allowedEmpresas !== undefined &&
      body.allowedEmpresas !== null
    ) {
      return NextResponse.json(
        {
          error:
            "Falta aplicar migracion de empresas permitidas en app_users (db/migrations/20260723_dinastia_tenant_tables.sql).",
        },
        { status: 400 },
      );
    }
    if (!allowedSubdashboardsEnabled && body.allowedSubdashboards !== undefined) {
      return NextResponse.json(
        {
          error:
            "Falta aplicar migracion de subtableros permitidos en app_users.",
        },
        { status: 400 },
      );
    }
    if (!specialRolesEnabled && body.specialRoles !== undefined) {
      return NextResponse.json(
        {
          error:
            "Falta aplicar migracion de roles especiales en app_users (db/migrations/20260305_user_special_roles.sql).",
        },
        { status: 400 },
      );
    }
    const allowedSedes = role === "admin" ? null : allowedSedesResult.value;
    const allowedSedesJson =
      allowedSedes === null ? null : JSON.stringify(allowedSedes);
    const effectiveSedeForLegacy =
      role === "admin" ? null : allowedSedes?.[0] ?? sede ?? null;
    const allowedLines = role === "admin" ? null : allowedLinesResult.value;
    const allowedDashboards = role === "admin" ? null : allowedDashboardsResult.value;
    const allowedSubdashboards =
      role === "admin" ? null : allowedSubdashboardsResult.value;
    const specialRoles = role === "admin" ? null : specialRolesResult.value;
    const portalProfile = resolved.portalProfile;

    if (!sedeEnabled && role === "user") {
      return NextResponse.json(
        {
          error:
            "Falta aplicar migracion de sede en app_users (db/migrations/20260220_user_sede.sql).",
        },
        { status: 400 },
      );
    }
    const result =
      sedeEnabled &&
      allowedSedesEnabled &&
      allowedLinesEnabled &&
      allowedDashboardsEnabled
        ? specialRolesEnabled
          ? portalProfileEnabled
            ? await client.query(
                `
              INSERT INTO app_users (username, password_hash, role, sede, allowed_sedes, allowed_lines, allowed_dashboards, allowed_subdashboards, special_roles, portal_profile)
              VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
              RETURNING id, username, role, sede, allowed_sedes AS "allowedSedes", allowed_lines AS "allowedLines", allowed_dashboards AS "allowedDashboards", allowed_subdashboards AS "allowedSubdashboards", special_roles AS "specialRoles", portal_profile AS "portalProfile", is_active, created_at, updated_at
              `,
                [username, passwordHash, role, effectiveSedeForLegacy, allowedSedesJson, allowedLines, allowedDashboards, allowedSubdashboardsEnabled ? allowedSubdashboards : null, specialRoles, portalProfile],
              )
            : await client.query(
                `
              INSERT INTO app_users (username, password_hash, role, sede, allowed_sedes, allowed_lines, allowed_dashboards, allowed_subdashboards, special_roles)
              VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
              RETURNING id, username, role, sede, allowed_sedes AS "allowedSedes", allowed_lines AS "allowedLines", allowed_dashboards AS "allowedDashboards", allowed_subdashboards AS "allowedSubdashboards", special_roles AS "specialRoles", NULL::text AS "portalProfile", is_active, created_at, updated_at
              `,
                [username, passwordHash, role, effectiveSedeForLegacy, allowedSedesJson, allowedLines, allowedDashboards, allowedSubdashboardsEnabled ? allowedSubdashboards : null, specialRoles],
              )
          : await client.query(
              `
              INSERT INTO app_users (username, password_hash, role, sede, allowed_sedes, allowed_lines, allowed_dashboards)
              VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
              RETURNING id, username, role, sede, allowed_sedes AS "allowedSedes", allowed_lines AS "allowedLines", allowed_dashboards AS "allowedDashboards", NULL::text[] AS "allowedSubdashboards", NULL::text[] AS "specialRoles", is_active, created_at, updated_at
              `,
              [username, passwordHash, role, effectiveSedeForLegacy, allowedSedesJson, allowedLines, allowedDashboards],
            )
        : sedeEnabled
          ? await client.query(
              `
              INSERT INTO app_users (username, password_hash, role, sede)
              VALUES ($1, $2, $3, $4)
              RETURNING id, username, role, sede, NULL::jsonb AS "allowedSedes", NULL::jsonb AS "allowedLines", NULL::jsonb AS "allowedDashboards", NULL::text[] AS "allowedSubdashboards", NULL::text[] AS "specialRoles", is_active, created_at, updated_at
              `,
              [username, passwordHash, role, effectiveSedeForLegacy],
            )
          : await client.query(
              `
              INSERT INTO app_users (username, password_hash, role)
              VALUES ($1, $2, $3)
              RETURNING id, username, role, NULL::text AS sede, NULL::jsonb AS "allowedSedes", NULL::jsonb AS "allowedLines", NULL::jsonb AS "allowedDashboards", NULL::text[] AS "allowedSubdashboards", NULL::text[] AS "specialRoles", is_active, created_at, updated_at
              `,
              [username, passwordHash, role],
            );
    const allowedEmpresas =
      role === "admin"
        ? null
        : allowedEmpresasResult.value === undefined
          ? null
          : allowedEmpresasResult.value;
    if (
      allowedEmpresasEnabled &&
      result.rows?.[0] &&
      typeof (result.rows[0] as { id?: string }).id === "string"
    ) {
      await client.query(
        `
        UPDATE app_users
        SET allowed_empresas = $1::jsonb
        WHERE id = $2
        `,
        [
          allowedEmpresas === null ? null : JSON.stringify(allowedEmpresas),
          (result.rows[0] as { id: string }).id,
        ],
      );
    }
    const user =
      result.rows && result.rows[0]
        ? {
            ...(result.rows[0] as {
              allowedDashboards?: string[] | null;
              allowedSubdashboards?: string[] | null;
            }),
            allowedDashboards: normalizeAllowedPortalSections(
              (result.rows[0] as { allowedDashboards?: string[] | null })
                .allowedDashboards,
            ),
            allowedSubdashboards: normalizeAllowedPortalSubsections(
              (result.rows[0] as { allowedSubdashboards?: string[] | null })
                .allowedSubdashboards,
            ),
          }
        : null;
    if (user && typeof (user as { id?: string }).id === "string") {
      const created = user as {
        id: string;
        username: string;
        role: string;
        portalProfile?: string | null;
        sede?: string | null;
        allowedSedes?: string[] | null;
        allowedLines?: string[] | null;
        allowedDashboards?: string[] | null;
        allowedSubdashboards?: string[] | null;
        specialRoles?: string[] | null;
        is_active?: boolean;
      };
      const after = buildUserAuditSnapshot({
        username: created.username,
        role: created.role,
        portalProfile: created.portalProfile ?? portalProfile,
        sede: created.sede ?? null,
        allowedSedes: created.allowedSedes ?? allowedSedes,
        allowedLines: created.allowedLines ?? allowedLines,
        allowedDashboards: created.allowedDashboards ?? allowedDashboards,
        allowedSubdashboards:
          created.allowedSubdashboards ?? allowedSubdashboards,
        specialRoles: created.specialRoles ?? specialRoles,
        isActive: created.is_active !== false,
      });
      await insertUserAdminAudit(client, {
        actorUserId: session.user.id,
        actorUsername: session.user.username,
        targetUserId: created.id,
        targetUsername: created.username,
        action: "create",
        before: null,
        after,
        actorIp: getAuditNetworkId(getClientIp(req)) ?? getClientIp(req),
        actorUserAgent: req.headers.get("user-agent"),
      });
    }
    return withSession(NextResponse.json({ user }));
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "No se pudo crear el usuario.";
    return NextResponse.json(
      { error: detail },
      { status: 400 },
    );
  } finally {
    client.release();
  }
}
