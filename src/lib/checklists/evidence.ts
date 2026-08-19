import {
  stripDataUrlPrefix,
  isLikelyBase64,
} from "@/lib/rotacion/restock-surtido-foto";

export const CHECKLIST_MIGRATION_HINT =
  "Aplica db/migrations/20260819_checklist_runs.sql, 20260819_checklist_run_workflow.sql y 20260819_checklist_evidence.sql";

export const CHECKLIST_FOTO_MAX_BASE64_CHARS = 700_000;
export const CHECKLIST_SIGNATURE_MIN_CHARS = 1200;

export const isChecklistSchemaError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  return code === "42P01" || code === "42703";
};

export const requiresChecklistPhoto = (value: unknown): boolean =>
  value === "P" || value === "NC";

export const missingChecklistPhotoKeys = (
  answers: Record<string, { v?: unknown } | null | undefined>,
  evidenceKeys: Iterable<string>,
): string[] => {
  const have = new Set(
    [...evidenceKeys].map((key) => String(key).trim()).filter(Boolean),
  );
  return Object.entries(answers)
    .filter(([, item]) => requiresChecklistPhoto(item?.v))
    .map(([key]) => key)
    .filter((key) => !have.has(key));
};

export const parseChecklistSignature = (
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } => {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "Debes firmar antes de guardar el checklist." };
  }
  const base64 = stripDataUrlPrefix(raw);
  if (base64.length < CHECKLIST_SIGNATURE_MIN_CHARS) {
    return {
      ok: false,
      error: "La firma está vacía. Dibuja tu firma en el recuadro.",
    };
  }
  if (base64.length > CHECKLIST_FOTO_MAX_BASE64_CHARS) {
    return { ok: false, error: "La firma es demasiado pesada. Vuelve a firmar." };
  }
  if (!isLikelyBase64(base64)) {
    return { ok: false, error: "La firma no se pudo leer." };
  }
  const prefix = raw.trim().startsWith("data:image/jpeg")
    ? "data:image/jpeg;base64,"
    : "data:image/png;base64,";
  return { ok: true, value: `${prefix}${base64}` };
};

export const parseChecklistEvidencePhoto = (
  rawBase64: unknown,
  rawMime: unknown,
):
  | { ok: true; base64: string; mime: "image/jpeg" | "image/png" | "image/webp" }
  | { ok: false; error: string } => {
  const mimeRaw = String(rawMime ?? "image/jpeg")
    .trim()
    .toLowerCase();
  const mime =
    mimeRaw === "image/jpg"
      ? "image/jpeg"
      : mimeRaw === "image/png" || mimeRaw === "image/webp" || mimeRaw === "image/jpeg"
        ? mimeRaw
        : null;
  if (!mime) {
    return { ok: false, error: "Formato de foto no permitido. Usa JPEG, PNG o WebP." };
  }
  if (typeof rawBase64 !== "string") {
    return { ok: false, error: "Falta la foto." };
  }
  const base64 = stripDataUrlPrefix(rawBase64);
  if (base64.length < 24) {
    return { ok: false, error: "La foto está vacía o no se pudo leer." };
  }
  if (base64.length > CHECKLIST_FOTO_MAX_BASE64_CHARS) {
    return {
      ok: false,
      error: "La foto es demasiado pesada. Toma otra más cercana.",
    };
  }
  if (!isLikelyBase64(base64)) {
    return { ok: false, error: "La foto no llegó en un encoding válido." };
  }
  return { ok: true, base64, mime };
};
