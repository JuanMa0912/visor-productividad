import type { InformeVariacionMonthBundle } from "@/lib/informe-variacion/daily-bundle";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

export type InformeApiResponse = InformeVariacionPayload & { error?: string };

export type InformeBundleApiResponse =
  | (InformeVariacionMonthBundle & { error?: string })
  | { bundle: false; error?: string };

export const isInformeMonthBundleResponse = (
  data: InformeBundleApiResponse | InformeApiResponse,
): data is InformeVariacionMonthBundle & { error?: string } =>
  typeof data === "object" &&
  data !== null &&
  "bundle" in data &&
  data.bundle === true;

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

export const readInformeBundleApiResponse = async (
  response: Response,
): Promise<InformeBundleApiResponse> => {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("El servidor devolvio una respuesta vacia.");
  }

  try {
    return JSON.parse(text) as InformeBundleApiResponse;
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
