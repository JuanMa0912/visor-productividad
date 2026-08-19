import type { PoolClient } from "pg";
import type { ChecklistActorRole } from "@/lib/checklists/access";
import { getChecklistPeriod } from "@/lib/checklists/period";
import {
  hasDeadlinePassed,
  nextDeadlineAt,
  remainingMs,
  type ChecklistRunRow,
  type ChecklistRunStatus,
  type ChecklistSessionId,
} from "@/lib/checklists/session";
import type { ChecklistSnapshot } from "@/lib/checklists/snapshot";

const RUN_COLUMNS = `
  r.id, r.user_id, u.username, r.checklist_id, r.status, r.started_at,
  r.deadline_at, r.completed_at, r.expired_at, r.reopened_by, r.reopened_at,
  r.actor_role, r.empresa, r.sede, r.period_year, r.period_month,
  r.answers, r.score_pct, r.duration_seconds
`;

type DbRun = {
  id: string;
  user_id: string;
  username?: string | null;
  checklist_id: string;
  status: ChecklistRunStatus;
  started_at: Date | string;
  deadline_at: Date | string;
  completed_at: Date | string | null;
  expired_at: Date | string | null;
  reopened_by: string | null;
  reopened_at: Date | string | null;
  actor_role: ChecklistActorRole | null;
  empresa: string | null;
  sede: string | null;
  period_year: number | null;
  period_month: number | null;
  answers: unknown;
  score_pct: string | number | null;
  duration_seconds: number | null;
  signature_png?: string | null;
  has_signature?: boolean;
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toScore = (value: string | number | null | undefined): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const mapChecklistRun = (
  row: DbRun,
  now = new Date(),
): ChecklistRunRow => {
  const deadlineAt = toIso(row.deadline_at) ?? now.toISOString();
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username ?? undefined,
    checklistId: row.checklist_id as ChecklistSessionId,
    status: row.status,
    startedAt: toIso(row.started_at) ?? now.toISOString(),
    deadlineAt,
    completedAt: toIso(row.completed_at),
    expiredAt: toIso(row.expired_at),
    reopenedBy: row.reopened_by,
    reopenedAt: toIso(row.reopened_at),
    remainingMs: row.status === "in_progress" ? remainingMs(deadlineAt, now) : 0,
    actorRole: row.actor_role,
    empresa: row.empresa,
    sede: row.sede,
    periodYear: row.period_year,
    periodMonth: row.period_month,
    scorePct: toScore(row.score_pct),
    durationSeconds: row.duration_seconds,
    answers: row.answers ?? null,
    hasSignature: Boolean(row.has_signature) || Boolean(row.signature_png),
  };
};

export const expireIfNeeded = async (
  client: PoolClient,
  row: DbRun | null,
  now = new Date(),
): Promise<DbRun | null> => {
  if (!row || row.status !== "in_progress") return row;
  if (!hasDeadlinePassed(row.deadline_at, now)) return row;
  const updated = await client.query<DbRun>(
    `
    UPDATE checklist_run r
    SET status = 'expired',
        expired_at = COALESCE(expired_at, $2::timestamptz),
        updated_at = $2::timestamptz
    WHERE id = $1::uuid AND status = 'in_progress'
    RETURNING ${RETURNING_SIMPLE}
    `,
    [row.id, now.toISOString()],
  );
  return updated.rows[0] ?? { ...row, status: "expired", expired_at: now };
};

const RETURNING_SIMPLE = `
  id, user_id, checklist_id, status, started_at, deadline_at,
  completed_at, expired_at, reopened_by, reopened_at,
  actor_role, empresa, sede, period_year, period_month,
  answers, score_pct, duration_seconds
`;

export const loadLatestRun = async (
  client: PoolClient,
  userId: string,
  checklistId: ChecklistSessionId,
): Promise<DbRun | null> => {
  const result = await client.query<DbRun>(
    `
    SELECT ${RETURNING_SIMPLE}, NULL::text AS username
    FROM checklist_run
    WHERE user_id = $1::uuid AND checklist_id = $2
    ORDER BY started_at DESC
    LIMIT 1
    `,
    [userId, checklistId],
  );
  return result.rows[0] ?? null;
};

export const findMonthlyRun = async (
  client: PoolClient,
  checklistId: ChecklistSessionId,
  sede: string,
  actorRole: ChecklistActorRole,
  year: number,
  month: number,
): Promise<DbRun | null> => {
  const result = await client.query<DbRun>(
    `
    SELECT ${RETURNING_SIMPLE}, NULL::text AS username
    FROM checklist_run
    WHERE checklist_id = $1
      AND lower(btrim(sede)) = lower(btrim($2))
      AND actor_role = $3
      AND period_year = $4
      AND period_month = $5
      AND status IN ('in_progress', 'completed', 'expired')
    ORDER BY started_at DESC
    LIMIT 1
    `,
    [checklistId, sede, actorRole, year, month],
  );
  return result.rows[0] ?? null;
};

export const findLatestEncargadoRun = async (
  client: PoolClient,
  checklistId: ChecklistSessionId,
  sede: string,
  year: number,
  month: number,
): Promise<DbRun | null> => {
  const result = await client.query<DbRun>(
    `
    SELECT ${RETURNING_SIMPLE}, u.username
    FROM checklist_run r
    JOIN app_users u ON u.id = r.user_id
    WHERE r.checklist_id = $1
      AND lower(btrim(r.sede)) = lower(btrim($2))
      AND r.actor_role = 'encargado'
      AND r.status = 'completed'
      AND (
        (r.period_year = $3 AND r.period_month = $4)
        OR r.completed_at >= now() - interval '45 days'
      )
    ORDER BY
      CASE WHEN r.period_year = $3 AND r.period_month = $4 THEN 0 ELSE 1 END,
      r.completed_at DESC NULLS LAST
    LIMIT 1
    `,
    [checklistId, sede, year, month],
  );
  return result.rows[0] ?? null;
};

export const startChecklistRun = async (
  client: PoolClient,
  input: {
    userId: string;
    checklistId: ChecklistSessionId;
    actorRole: ChecklistActorRole;
    empresa: string;
    sede: string;
  },
  now = new Date(),
): Promise<DbRun> => {
  const deadline = nextDeadlineAt(now);
  const period = getChecklistPeriod(now);
  const inserted = await client.query<DbRun>(
    `
    INSERT INTO checklist_run (
      user_id, checklist_id, status, started_at, deadline_at, updated_at,
      actor_role, empresa, sede, period_year, period_month
    )
    VALUES (
      $1::uuid, $2, 'in_progress', $3::timestamptz, $4::timestamptz, $3::timestamptz,
      $5, $6, $7, $8, $9
    )
    RETURNING ${RETURNING_SIMPLE}
    `,
    [
      input.userId,
      input.checklistId,
      now.toISOString(),
      deadline.toISOString(),
      input.actorRole,
      input.empresa,
      input.sede,
      period.year,
      period.month,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error("No se pudo crear el intento de checklist.");
  return row;
};

export const saveChecklistSnapshot = async (
  client: PoolClient,
  runId: string,
  userId: string,
  snapshot: ChecklistSnapshot,
  now = new Date(),
): Promise<DbRun | null> => {
  const updated = await client.query<DbRun>(
    `
    UPDATE checklist_run
    SET answers = $3::jsonb,
        score_pct = $4,
        duration_seconds = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($5::timestamptz - started_at)))),
        updated_at = $5::timestamptz
    WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'in_progress'
    RETURNING ${RETURNING_SIMPLE}
    `,
    [
      runId,
      userId,
      JSON.stringify(snapshot),
      snapshot.scorePct,
      now.toISOString(),
    ],
  );
  return updated.rows[0] ?? null;
};

export const completeChecklistRun = async (
  client: PoolClient,
  runId: string,
  userId: string,
  snapshot: ChecklistSnapshot | null,
  signaturePng: string,
  now = new Date(),
): Promise<DbRun | null> => {
  const updated = await client.query<DbRun>(
    `
    UPDATE checklist_run
    SET status = 'completed',
        completed_at = $3::timestamptz,
        updated_at = $3::timestamptz,
        answers = COALESCE($4::jsonb, answers),
        score_pct = COALESCE($5, score_pct),
        signature_png = $6,
        duration_seconds = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($3::timestamptz - started_at))))
    WHERE id = $1::uuid
      AND user_id = $2::uuid
      AND status = 'in_progress'
      AND deadline_at > $3::timestamptz
    RETURNING ${RETURNING_SIMPLE}
    `,
    [
      runId,
      userId,
      now.toISOString(),
      snapshot ? JSON.stringify(snapshot) : null,
      snapshot?.scorePct ?? null,
      signaturePng,
    ],
  );
  return updated.rows[0] ?? null;
};

export const listChecklistEvidenceKeys = async (
  client: PoolClient,
  runId: string,
): Promise<string[]> => {
  const result = await client.query<{ item_key: string }>(
    `
    SELECT item_key
    FROM checklist_run_evidence
    WHERE run_id = $1::uuid
    ORDER BY item_key
    `,
    [runId],
  );
  return result.rows.map((row) => String(row.item_key).trim()).filter(Boolean);
};

export const upsertChecklistEvidence = async (
  client: PoolClient,
  input: {
    runId: string;
    userId: string;
    itemKey: string;
    fotoBase64: string;
    mime: string;
  },
  now = new Date(),
): Promise<boolean> => {
  const owned = await client.query(
    `
    SELECT 1
    FROM checklist_run
    WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'in_progress'
    `,
    [input.runId, input.userId],
  );
  if (!owned.rowCount) return false;
  await client.query(
    `
    INSERT INTO checklist_run_evidence (run_id, item_key, foto_base64, mime, updated_at)
    VALUES ($1::uuid, $2, $3, $4, $5::timestamptz)
    ON CONFLICT (run_id, item_key) DO UPDATE
    SET foto_base64 = EXCLUDED.foto_base64,
        mime = EXCLUDED.mime,
        updated_at = EXCLUDED.updated_at
    `,
    [
      input.runId,
      input.itemKey,
      input.fotoBase64,
      input.mime,
      now.toISOString(),
    ],
  );
  return true;
};

export const getChecklistEvidence = async (
  client: PoolClient,
  runId: string,
  userId: string,
  itemKey: string,
): Promise<{ fotoBase64: string; mime: string } | null> => {
  const result = await client.query<{ foto_base64: string; mime: string }>(
    `
    SELECT e.foto_base64, e.mime
    FROM checklist_run_evidence e
    JOIN checklist_run r ON r.id = e.run_id
    WHERE e.run_id = $1::uuid
      AND e.item_key = $2
      AND r.user_id = $3::uuid
    LIMIT 1
    `,
    [runId, itemKey, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { fotoBase64: row.foto_base64, mime: row.mime };
};

export const reopenChecklistRun = async (
  client: PoolClient,
  runId: string,
  actorUserId: string,
  now = new Date(),
): Promise<DbRun | null> => {
  const deadline = nextDeadlineAt(now);
  const updated = await client.query<DbRun>(
    `
    UPDATE checklist_run
    SET status = 'in_progress',
        deadline_at = $3::timestamptz,
        expired_at = NULL,
        reopened_by = $2::uuid,
        reopened_at = $4::timestamptz,
        updated_at = $4::timestamptz
    WHERE id = $1::uuid AND status IN ('expired', 'in_progress')
      AND (status = 'expired' OR deadline_at <= $4::timestamptz)
    RETURNING ${RETURNING_SIMPLE}
    `,
    [runId, actorUserId, deadline.toISOString(), now.toISOString()],
  );
  return updated.rows[0] ?? null;
};

export const listExpiredChecklistRuns = async (
  client: PoolClient,
  now = new Date(),
): Promise<DbRun[]> => {
  await client.query(
    `
    UPDATE checklist_run
    SET status = 'expired',
        expired_at = COALESCE(expired_at, $1::timestamptz),
        updated_at = $1::timestamptz
    WHERE status = 'in_progress' AND deadline_at <= $1::timestamptz
    `,
    [now.toISOString()],
  );
  const result = await client.query<DbRun>(
    `
    SELECT ${RUN_COLUMNS}
    FROM checklist_run r
    JOIN app_users u ON u.id = r.user_id
    WHERE r.status = 'expired'
    ORDER BY r.deadline_at DESC
    LIMIT 80
    `,
  );
  return result.rows;
};

export const listPanelChecklistRuns = async (
  client: PoolClient,
  year: number,
  month: number,
  now = new Date(),
): Promise<DbRun[]> => {
  await client.query(
    `
    UPDATE checklist_run
    SET status = 'expired',
        expired_at = COALESCE(expired_at, $1::timestamptz),
        updated_at = $1::timestamptz
    WHERE status = 'in_progress' AND deadline_at <= $1::timestamptz
    `,
    [now.toISOString()],
  );
  const result = await client.query<DbRun>(
    `
    SELECT ${RUN_COLUMNS}
    FROM checklist_run r
    JOIN app_users u ON u.id = r.user_id
    WHERE r.period_year = $2 AND r.period_month = $3
    ORDER BY r.started_at DESC
    LIMIT 400
    `,
    [now.toISOString(), year, month],
  );
  return result.rows;
};
