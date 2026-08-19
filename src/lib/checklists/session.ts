export const CHECKLIST_DURATION_MS = 20 * 60 * 1000;
export const CHECKLIST_DURATION_MINUTES = 20;

export const CHECKLIST_SESSION_IDS = [
  "bodega-gerencial",
  "punto-venta",
] as const;

export type ChecklistSessionId = (typeof CHECKLIST_SESSION_IDS)[number];

export type ChecklistRunStatus = "in_progress" | "completed" | "expired";

export type ChecklistActorRole = "encargado" | "revisor";

export type ChecklistRunRow = {
  id: string;
  userId: string;
  username?: string;
  checklistId: ChecklistSessionId;
  status: ChecklistRunStatus;
  startedAt: string;
  deadlineAt: string;
  completedAt: string | null;
  expiredAt: string | null;
  reopenedBy: string | null;
  reopenedAt: string | null;
  remainingMs: number;
  actorRole: ChecklistActorRole | null;
  empresa: string | null;
  sede: string | null;
  periodYear: number | null;
  periodMonth: number | null;
  scorePct: number | null;
  durationSeconds: number | null;
  answers?: unknown;
};

export const isChecklistSessionId = (value: string): value is ChecklistSessionId =>
  (CHECKLIST_SESSION_IDS as readonly string[]).includes(value);

export const remainingMs = (deadlineAt: Date | string, now = new Date()): number => {
  const deadline =
    deadlineAt instanceof Date ? deadlineAt.getTime() : new Date(deadlineAt).getTime();
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, deadline - now.getTime());
};

export const hasDeadlinePassed = (
  deadlineAt: Date | string,
  now = new Date(),
): boolean => remainingMs(deadlineAt, now) <= 0;

export const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const nextDeadlineAt = (from = new Date()): Date =>
  new Date(from.getTime() + CHECKLIST_DURATION_MS);
