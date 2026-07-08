import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

export type InformeApiResponse = InformeVariacionPayload & { error?: string };

export const readInformeApiResponse = async (
  response: Response,
): Promise<InformeApiResponse> => {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("El servidor devolvio una respuesta vacia.");
  }

  try {
    return JSON.parse(text) as InformeApiResponse;
  } catch {
    const normalized = text.replace(/\s+/g, " ").trim().slice(0, 160);
    if (/upstream/i.test(text)) {
      throw new Error(
        "El servidor corto la consulta por tiempo (upstream timeout). Prueba un mes o rango con menos datos.",
      );
    }
    if (response.status >= 500) {
      throw new Error(
        `Error del servidor (${response.status}). ${normalized || "Sin detalle."}`,
      );
    }
    throw new Error(`Respuesta invalida del servidor: ${normalized}`);
  }
};
