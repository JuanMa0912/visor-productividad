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

type Params = { params: Promise<{ id: string }> };
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
  "comparar_horarios",
]);

const resolveValidSede = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
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
      error: "Los roles especiales no son validos.",
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
      error: "Hay roles especiales no validos en la seleccion.",
    };
  }
  return { ok: true as const, value: normalized };
};

export async function PATCH(req: Request, { params }: Params) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const { id } = await params;
  const withSession = (response: NextResponse) => applySessionCookies(response, session);

  if (!(await verifyCsrf(req))) {
    return withSession(
      NextResponse.json({ error: "CSRF inválido." }, { status: 403 }),
    );
  }

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 20,
    keyPrefix: "admin-users-patch",
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
    role?: "admin" | "user";
    sede?: string | null;
    allowedSedes?: string[] | null;
    allowedLines?: string[] | null;
    allowedDashboards?: string[] | null;
    specialRoles?: string[] | null;
    is_active?: boolean;
    password?: string;
  };

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
    const currentResult = await client.query(
      `
      SELECT
        u.role,
        to_jsonb(u)->>'sede' AS sede,
        to_jsonb(u)->'allowed_sedes' AS "allowedSedes",
        to_jsonb(u)->'allowed_lines' AS "allowedLines",
        to_jsonb(u)->'allowed_dashboards' AS "allowedDashboards",
        to_jsonb(u)->'special_roles' AS "specialRoles"
      FROM app_users u
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );
    if (!currentResult.rows || currentResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Usuario no encontrado." },
        { status: 404 },
      );
    }

    const currentUser = currentResult.rows[0] as {
      role: "admin" | "user";
      sede: string | null;
      allowedSedes: string[] | null;
      allowedLines: string[] | null;
      allowedDashboards: string[] | null;
      specialRoles: string[] | null;
    };
    currentUser.allowedDashboards = normalizeAllowedPortalSections(
      currentUser.allowedDashboards,
    );
    const allowedSedesResult = resolveValidAllowedSedes(body.allowedSedes);
    const allowedLinesResult = resolveValidAllowedLines(body.allowedLines);
    const allowedDashboardsResult = resolveValidAllowedDashboards(body.allowedDashboards);
    const specialRolesResult = resolveValidSpecialRoles(body.specialRoles);

    if (typeof body.sede === "string" && !resolveValidSede(body.sede)) {
      return NextResponse.json(
        { error: "La sede no es valida." },
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

    const nextRole =
      body.role === "admin" || body.role === "user" ? body.role : currentUser.role;
    const nextSede =
      body.sede === null
        ? null
        : typeof body.sede === "string"
          ? resolveValidSede(body.sede)
          : currentUser.sede;
    const nextAllowedSedes =
      body.allowedSedes === undefined
        ? currentUser.allowedSedes
        : allowedSedesResult.value;
    const nextAllowedLines =
      body.allowedLines === undefined
        ? currentUser.allowedLines
        : allowedLinesResult.value;
    const nextAllowedDashboards =
      body.allowedDashboards === undefined
        ? currentUser.allowedDashboards
        : allowedDashboardsResult.value;
    const nextSpecialRoles =
      body.specialRoles === undefined
        ? currentUser.specialRoles
        : specialRolesResult.value;

    if (nextRole === "user" && !nextSede && (!nextAllowedSedes || nextAllowedSedes.length === 0)) {
      return NextResponse.json(
        { error: "Los usuarios de rol user deben tener sede asignada." },
        { status: 400 },
      );
    }
    if (!sedeEnabled && (body.sede !== undefined || nextRole === "user")) {
      return NextResponse.json(
        {
          error:
            "Falta aplicar migracion de sede en app_users (db/migrations/20260220_user_sede.sql).",
        },
        { status: 400 },
      );
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const addUpdate = (field: string, value: unknown) => {
      updates.push(`${field} = $${idx++}`);
      values.push(value);
    };

    if (typeof body.username === "string") {
      addUpdate("username", body.username.trim());
    }
    if (body.role === "admin" || body.role === "user") {
      addUpdate("role", body.role);
      if (body.role === "admin" && body.sede === undefined) {
        addUpdate("sede", null);
      }
      if (
        allowedSedesEnabled &&
        body.role === "admin" &&
        body.allowedSedes === undefined
      ) {
        addUpdate("allowed_sedes", null);
      }
      if (allowedLinesEnabled && body.role === "admin" && body.allowedLines === undefined) {
        addUpdate("allowed_lines", null);
      }
      if (
        allowedDashboardsEnabled &&
        body.role === "admin" &&
        body.allowedDashboards === undefined
      ) {
        addUpdate("allowed_dashboards", null);
      }
      if (
        specialRolesEnabled &&
        body.role === "admin" &&
        body.specialRoles === undefined
      ) {
        addUpdate("special_roles", null);
      }
    }
    if (sedeEnabled && body.sede !== undefined) {
      addUpdate("sede", nextSede);
    }
    if (allowedSedesEnabled && body.allowedSedes !== undefined) {
      updates.push(`allowed_sedes = $${idx++}::jsonb`);
      values.push(
        nextRole === "admin" || nextAllowedSedes === null
          ? null
          : JSON.stringify(nextAllowedSedes),
      );
      if (sedeEnabled && body.sede === undefined) {
        addUpdate("sede", nextRole === "admin" ? null : nextAllowedSedes?.[0] ?? nextSede ?? null);
      }
    } else if (!allowedSedesEnabled && sedeEnabled && body.allowedSedes !== undefined) {
      addUpdate("sede", nextRole === "admin" ? null : nextAllowedSedes?.[0] ?? nextSede ?? null);
    }
    if (allowedLinesEnabled && body.allowedLines !== undefined) {
      addUpdate("allowed_lines", nextRole === "admin" ? null : nextAllowedLines);
    }
    if (allowedDashboardsEnabled && body.allowedDashboards !== undefined) {
      addUpdate(
        "allowed_dashboards",
        nextRole === "admin" ? null : nextAllowedDashboards,
      );
    }
    if (specialRolesEnabled && body.specialRoles !== undefined) {
      addUpdate(
        "special_roles",
        nextRole === "admin" ? null : nextSpecialRoles,
      );
    }
    if (typeof body.is_active === "boolean") {
      addUpdate("is_active", body.is_active);
    }
    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length < 8) {
        return NextResponse.json(
          { error: "La contrasena debe tener minimo 8 caracteres." },
          { status: 400 },
        );
      }
      const passwordHash = await hashPassword(body.password);
      addUpdate("password_hash", passwordHash);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No hay cambios para actualizar." },
        { status: 400 },
      );
    }

    updates.push("updated_at = now()");
    values.push(id);

    const result = await client.query(
      `
      UPDATE app_users
      SET ${updates.join(", ")}
      WHERE id = $${idx}
      RETURNING id, username, role, sede, allowed_sedes AS "allowedSedes", allowed_lines AS "allowedLines", allowed_dashboards AS "allowedDashboards", to_jsonb(app_users)->'special_roles' AS "specialRoles", is_active, created_at, updated_at, last_login_at, last_login_ip
      `,
      values,
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
      error instanceof Error ? error.message : "No se pudo actualizar el usuario.";
    return NextResponse.json(
      { error: detail },
      { status: 400 },
    );
  } finally {
    client.release();
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const { id } = await params;
  const withSession = (response: NextResponse) => applySessionCookies(response, session);

  if (!(await verifyCsrf(_req))) {
    return withSession(
      NextResponse.json({ error: "CSRF inválido." }, { status: 403 }),
    );
  }

  const limitedUntil = checkRateLimit(_req, {
    windowMs: 60_000,
    max: 15,
    keyPrefix: "admin-users-delete",
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

  if (session.user.id === id) {
    return NextResponse.json(
      { error: "No puedes eliminar tu propio usuario." },
      { status: 400 },
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    await client.query(`DELETE FROM app_users WHERE id = $1`, [id]);
    return withSession(NextResponse.json({ ok: true }));
  } finally {
    client.release();
  }
}
