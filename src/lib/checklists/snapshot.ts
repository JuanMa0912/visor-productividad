export type ChecklistAnswerSnap = {
  v: string | number | null;
  n?: string;
};

export type ChecklistSnapshot = {
  answers: Record<string, ChecklistAnswerSnap>;
  scorePct: number | null;
};

export const emptyChecklistSnapshot = (): ChecklistSnapshot => ({
  answers: {},
  scorePct: null,
});

export const parseChecklistSnapshot = (raw: unknown): ChecklistSnapshot => {
  if (!raw || typeof raw !== "object") return emptyChecklistSnapshot();
  const record = raw as { answers?: unknown; scorePct?: unknown };
  const answers: Record<string, ChecklistAnswerSnap> = {};
  if (record.answers && typeof record.answers === "object") {
    for (const [key, value] of Object.entries(record.answers)) {
      if (!value || typeof value !== "object") continue;
      const item = value as { v?: unknown; n?: unknown };
      const v =
        typeof item.v === "string" || typeof item.v === "number" || item.v === null
          ? item.v
          : null;
      answers[key] = {
        v,
        n: typeof item.n === "string" ? item.n : undefined,
      };
    }
  }
  const scorePct =
    typeof record.scorePct === "number" && Number.isFinite(record.scorePct)
      ? record.scorePct
      : null;
  return { answers, scorePct };
};

export const formatPriorAnswer = (value: string | number | null | undefined) => {
  if (value == null || value === "") return "—";
  if (value === "na") return "N.A.";
  return String(value);
};
