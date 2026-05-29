import { PPT_SEDE_KEYS } from "./hourly-constants";
import type { OvertimeEmployee } from "./types";

export const compareOvertimeText = (left: string, right: string) =>
  left.localeCompare(right, "es", { sensitivity: "base" });

export const getOvertimeDateTimestamp = (employee: OvertimeEmployee) => {
  if (!employee.workedDate) return 0;
  const timestamp = new Date(employee.workedDate).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export const getOvertimeIncidentValue = (employee: OvertimeEmployee) =>
  employee.incident?.trim() ?? "";

export const getOvertimeEstadoValue = (employee: OvertimeEmployee) =>
  employee.estadoAsistencia?.trim() ?? "";

export const getOvertimeNominaValue = (employee: OvertimeEmployee) =>
  employee.nomina?.trim() ?? "";

export const getOvertimeDepartmentValue = (employee: OvertimeEmployee) =>
  employee.department?.trim() || employee.lineName?.trim() || "";

export const normalizeSedeValue = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");

export const canonicalizeSedeValue = (value: string) => {
  const normalized = normalizeSedeValue(value);
  const compact = normalized.replace(/\s+/g, "");
  if (
    normalized === "calle 5a" ||
    normalized === "la 5a" ||
    normalized === "calle 5" ||
    compact === "calle5a" ||
    compact === "la5a" ||
    compact === "calle5"
  ) {
    return normalizeSedeValue("Calle 5ta");
  }
  return normalized;
};

export const isPptSede = (sedeName: string) =>
  PPT_SEDE_KEYS.has(canonicalizeSedeValue(sedeName));

export const normalizeIncidentValue = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");

export const isAbsenceIncident = (value: string | null | undefined) =>
  normalizeIncidentValue(value).includes("inasistencia");

export const normalizeEmployeeType = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
