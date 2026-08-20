import { getCanonicalSedeName } from "@/lib/shared/sede-names";
import { INFORME_EMPRESA_ORDER } from "@/lib/informe-variacion/types";

const TIPO_NAMES: Record<string, string> = {
  "1": "General",
  "3": "Asaderos",
  "4": "Mercado",
  C: "Concesiones",
  V: "Aprovechamientos",
};

const padLineCode = (value: string | null | undefined): string => {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return "00";
  return digits.padStart(2, "0").slice(-2);
};

export const informeEmpresaLabel = (empresa: string): string => {
  const key = empresa.trim().toLowerCase();
  const found = INFORME_EMPRESA_ORDER.find((entry) => entry.key === key);
  if (found) return found.label;
  if (key === "mercatodo") return "Comercializadora";
  return empresa.trim() || "—";
};

/** Quita el código de centro (`01 Floresta` → `Floresta`) en payloads viejos. */
export const stripInformeSedeDisplayName = (name: string): string =>
  name.replace(/^\d+\s+/, "").trim();

export const formatInformeSedeLabel = (
  empresa: string,
  idCo: string,
  fallbackLabel?: string,
): string => {
  const co = idCo.trim().padStart(3, "0");
  const canonical =
    getCanonicalSedeName(co, empresa.trim().toLowerCase()) ??
    stripInformeSedeDisplayName(fallbackLabel ?? "");
  return canonical || fallbackLabel?.trim() || co;
};

export const buildInformeCategoriaLabel = (idTipo: string): string => {
  const id = (idTipo ?? "").trim().toUpperCase();
  const name = TIPO_NAMES[id] ?? TIPO_NAMES[idTipo.trim()] ?? "Otros";
  return `${idTipo.trim()} ${name}`.trim();
};

export const buildInformeLineaLabel = (
  idLinea: string,
  nombre: string,
): string => {
  const code = padLineCode(idLinea);
  const label = (nombre ?? "").trim() || idLinea.trim() || "Sin línea";
  return `${code} ${label}`;
};

export const buildInformeSublineaLabel = (
  idLinea: string,
  nombre: string,
): string => buildInformeLineaLabel(idLinea, nombre);

export const buildInformeItemLabel = (
  idItem: string,
  descripcion: string,
): string => {
  const code = (idItem ?? "").trim();
  const desc = (descripcion ?? "").trim();
  if (code && desc) return `${code} ${desc}`;
  return code || desc || "Sin ítem";
};
