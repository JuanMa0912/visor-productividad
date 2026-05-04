/**
 * Cédulas que no deben mostrarse en listas del analisis por hora
 * (asistencia / aporte por cajero en GET /api/hourly-analysis).
 * Comparacion por digitos (ignora puntos o espacios en datos).
 *
 * Edita este archivo y despliega; no hace falta tocar .env en el servidor.
 */
const normalizeCedulaDigits = (value: string | null | undefined): string =>
  String(value ?? "").replace(/\D/g, "");

/** Solo digitos, tal como en BD o documento. */
export const HORARIOS_OCULTAR_CEDULA_DIGITS = [
  "1116284666",
  "1005873815",
] as const;

const OCULTAR_SET = new Set<string>(HORARIOS_OCULTAR_CEDULA_DIGITS);

export const isHorariosOcultarCedula = (
  documento: string | null | undefined,
): boolean => {
  const d = normalizeCedulaDigits(documento);
  return d.length > 0 && OCULTAR_SET.has(d);
};
