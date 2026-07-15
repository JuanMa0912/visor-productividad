import { NextResponse } from "next/server";
import { applySessionCookies, requireAdminSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { checkRateLimit } from "@/lib/shared/rate-limit";
import type { UserAuditSnapshot } from "@/lib/admin/user-admin-audit";

export type AdminAuditRow = {
  id: number;
  actorUserId: string | null;
  actorUsername: string | null;
  targetUserId: string | null;
  targetUsername: string;
  action: string;
  beforeState: UserAuditSnapshot | null;
  afterState: UserAuditSnapshot | null;
  changedFields: string[];
  actorIp: string | null;
  createdAt: string;
};

export type AdminAuditListResponse = {
  rows: AdminAuditRow[];
  generatedAt: string;
};

const toIso = (value: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
};

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 60,
    keyPrefix: "admin-audit-get",
  });
  if (limitedUntil) {
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes." },
        { status: 429 },
      ),
    );
  }

  const url = new URL(req.url);
  const targetUserId = url.searchParams.get("userId")?.trim() || null;
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(200, Math.max(1, Math.trunc(limitRaw)))
    : 50;

  const client = await (await getDbPool()).connect();
  try {
    const result = targetUserId
      ? await client.query(
          `
          SELECT
            id,
            actor_user_id AS "actorUserId",
            actor_username AS "actorUsername",
            target_user_id AS "targetUserId",
            target_username AS "targetUsername",
            action,
            before_state AS "beforeState",
            after_state AS "afterState",
            changed_fields AS "changedFields",
            actor_ip AS "actorIp",
            created_at AS "createdAt"
          FROM app_user_admin_audit
          WHERE target_user_id = $1
          ORDER BY created_at DESC
          LIMIT $2
          `,
          [targetUserId, limit],
        )
      : await client.query(
          `
          SELECT
            id,
            actor_user_id AS "actorUserId",
            actor_username AS "actorUsername",
            target_user_id AS "targetUserId",
            target_username AS "targetUsername",
            action,
            before_state AS "beforeState",
            after_state AS "afterState",
            changed_fields AS "changedFields",
            actor_ip AS "actorIp",
            created_at AS "createdAt"
          FROM app_user_admin_audit
          ORDER BY created_at DESC
          LIMIT $1
          `,
          [limit],
        );

    const rows: AdminAuditRow[] = (result.rows ?? []).map((row) => ({
      id: Number(row.id),
      actorUserId: row.actorUserId ?? null,
      actorUsername: row.actorUsername ?? null,
      targetUserId: row.targetUserId ?? null,
      targetUsername: String(row.targetUsername ?? ""),
      action: String(row.action ?? ""),
      beforeState: (row.beforeState as UserAuditSnapshot | null) ?? null,
      afterState: (row.afterState as UserAuditSnapshot | null) ?? null,
      changedFields: Array.isArray(row.changedFields)
        ? row.changedFields.map(String)
        : [],
      actorIp: row.actorIp ?? null,
      createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    }));

    return withSession(
      NextResponse.json({
        rows,
        generatedAt: new Date().toISOString(),
      } satisfies AdminAuditListResponse),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/app_user_admin_audit/i.test(message) && /does not exist|no existe/i.test(message)) {
      return withSession(
        NextResponse.json(
          {
            error:
              "Falta aplicar db/migrations/20260715_user_audit_trail.sql",
            rows: [],
            generatedAt: new Date().toISOString(),
          },
          { status: 503 },
        ),
      );
    }
    console.error("[admin/audit]", error);
    return withSession(
      NextResponse.json({ error: "No se pudo cargar la auditoria." }, { status: 500 }),
    );
  } finally {
    client.release();
  }
}
