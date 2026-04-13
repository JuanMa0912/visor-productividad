import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import {
  applySessionCookies,
  hashPassword,
  requireAdminSession,
  verifyCsrf,
} from "@/lib/auth";
import { ALLOWED_LINE_IDS, BRANCH_LOCATIONS } from "@/lib/constants";
import {
  normalizeAllowedPortalSections,
  resolvePortalSectionId,
} from "@/lib/portal-sections";
import { checkRateLimit } from "@/lib/rate-limit";

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
  "rotacion",
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
  const normalized = normalizeAllowedPortalSections(value) ?? [];
  if (!hasMeaningfulEntries || normalized.length === 0) {
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
  const invalid = normalized.filter((role) => !ALLOWED_SPECIAL_ROLE_SET.has(role));
  if (invalid.length > 0) {
    return {
      ok: false as const,
      error: "Hay roles especiales no válidos en la selección.",
    };
  }
  return { ok: true as const, value: normalized };
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
        to_jsonb(u)->'allowed_lines' AS "allowedLines",
        to_jsonb(u)->'allowed_dashboards' AS "allowedDashboards",
        to_jsonb(u)->'special_roles' AS "specialRoles",
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
        allowedDashboards?: string[] | null;
      };
      return {
        ...user,
        allowedDashboards: normalizeAllowedPortalSections(user.allowedDashboards),
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
    sede?: string | null;
    allowedSedes?: string[] | null;
    allowedLines?: string[] | null;
    allowedDashboards?: string[] | null;
    specialRoles?: string[] | null;
  };

  const username = body.username?.trim();
  const password = body.password ?? "";
  const role = body.role ?? "user";
  const sede = resolveValidSede(body.sede);
  const allowedSedesResult = resolveValidAllowedSedes(body.allowedSedes);
  const allowedLinesResult = resolveValidAllowedLines(body.allowedLines);
  const allowedDashboardsResult = resolveValidAllowedDashboards(body.allowedDashboards);
  const specialRolesResult = resolveValidSpecialRoles(body.specialRoles);

  if (!username || password.length < 8) {
    return NextResponse.json(
      { error: "Usuario y contraseña (mín 8) son obligatorios." },
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

  const passwordHash = await hashPassword(password);
  const client = await (await getDbPool()).connect();
  try {
    const sedeEnabled = await hasSedeColumn(client);
    const allowedSedesEnabled = await hasAllowedSedesColumn(client);
    const allowedLinesEnabled = await hasAllowedLinesColumn(client);
    const allowedDashboardsEnabled = await hasAllowedDashboardsColumn(client);
    const specialRolesEnabled = await hasSpecialRolesColumn(client);
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
    const specialRoles = role === "admin" ? null : specialRolesResult.value;

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
          ? await client.query(
              `
              INSERT INTO app_users (username, password_hash, role, sede, allowed_sedes, allowed_lines, allowed_dashboards, special_roles)
              VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
              RETURNING id, username, role, sede, allowed_sedes AS "allowedSedes", allowed_lines AS "allowedLines", allowed_dashboards AS "allowedDashboards", special_roles AS "specialRoles", is_active, created_at, updated_at
              `,
              [username, passwordHash, role, effectiveSedeForLegacy, allowedSedesJson, allowedLines, allowedDashboards, specialRoles],
            )
          : await client.query(
              `
              INSERT INTO app_users (username, password_hash, role, sede, allowed_sedes, allowed_lines, allowed_dashboards)
              VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
              RETURNING id, username, role, sede, allowed_sedes AS "allowedSedes", allowed_lines AS "allowedLines", allowed_dashboards AS "allowedDashboards", NULL::text[] AS "specialRoles", is_active, created_at, updated_at
              `,
              [username, passwordHash, role, effectiveSedeForLegacy, allowedSedesJson, allowedLines, allowedDashboards],
            )
        : sedeEnabled
          ? await client.query(
              `
              INSERT INTO app_users (username, password_hash, role, sede)
              VALUES ($1, $2, $3, $4)
              RETURNING id, username, role, sede, NULL::jsonb AS "allowedSedes", NULL::jsonb AS "allowedLines", NULL::jsonb AS "allowedDashboards", NULL::text[] AS "specialRoles", is_active, created_at, updated_at
              `,
              [username, passwordHash, role, effectiveSedeForLegacy],
            )
          : await client.query(
              `
              INSERT INTO app_users (username, password_hash, role)
              VALUES ($1, $2, $3)
              RETURNING id, username, role, NULL::text AS sede, NULL::jsonb AS "allowedSedes", NULL::jsonb AS "allowedLines", NULL::jsonb AS "allowedDashboards", NULL::text[] AS "specialRoles", is_active, created_at, updated_at
              `,
              [username, passwordHash, role],
            );
    const user =
      result.rows && result.rows[0]
        ? {
            ...(result.rows[0] as { allowedDashboards?: string[] | null }),
            allowedDashboards: normalizeAllowedPortalSections(
              (result.rows[0] as { allowedDashboards?: string[] | null })
                .allowedDashboards,
            ),
          }
        : null;
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
