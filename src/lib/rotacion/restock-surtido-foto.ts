export const RESTOCK_SURTIDO_FOTO_MAX_BASE64_CHARS = 700_000;
export const RESTOCK_SURTIDO_FOTO_MAX_EDGE_PX = 1280;
export const RESTOCK_SURTIDO_FOTO_JPEG_QUALITY = 0.72;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export type RestockSurtidoFotoMime = "image/jpeg" | "image/png" | "image/webp";

export const stripDataUrlPrefix = (raw: string): string => {
  const value = raw.trim();
  const comma = value.indexOf(",");
  if (value.startsWith("data:") && comma !== -1) {
    return value.slice(comma + 1).replace(/\s+/g, "");
  }
  return value.replace(/\s+/g, "");
};

export const isLikelyBase64 = (value: string): boolean =>
  value.length > 0 &&
  value.length % 4 === 0 &&
  /^[A-Za-z0-9+/]+={0,2}$/.test(value);

export const parseRestockSurtidoFotoMime = (
  raw: string | null | undefined,
): RestockSurtidoFotoMime | null => {
  if (!raw || typeof raw !== "string") return null;
  const mime = raw.trim().toLowerCase();
  if (mime === "image/jpg") return "image/jpeg";
  if (ALLOWED_MIME.has(mime)) return mime as RestockSurtidoFotoMime;
  return null;
};

export const validateRestockSurtidoFotoPayload = (
  rawBase64: string,
  rawMime: string,
):
  | { ok: true; base64: string; mime: RestockSurtidoFotoMime }
  | { ok: false; error: string } => {
  const mime = parseRestockSurtidoFotoMime(rawMime);
  if (!mime) {
    return { ok: false, error: "Formato de imagen no permitido. Usa JPEG, PNG o WebP." };
  }
  const base64 = stripDataUrlPrefix(rawBase64);
  if (base64.length < 24) {
    return { ok: false, error: "La foto esta vacia o no se pudo leer." };
  }
  if (base64.length > RESTOCK_SURTIDO_FOTO_MAX_BASE64_CHARS) {
    return {
      ok: false,
      error: "La foto es demasiado pesada. Toma otra mas cercana o con menos resolucion.",
    };
  }
  if (!isLikelyBase64(base64)) {
    return { ok: false, error: "La foto no llego en un encoding valido para SQL." };
  }
  return { ok: true, base64, mime };
};

export const restockSurtidoFotoDataUrl = (
  base64: string,
  mime: RestockSurtidoFotoMime | string,
): string => `data:${mime};base64,${base64}`;
