import {
  CERO_ROTACION_ESTADO_LABELS,
  parseCeroRotacionEstado,
} from "@/lib/rotacion/cero-estado";

export type SurtidoAuditApiRow = {
  id: string;
  sede_id: string;
  item: string;
  context: string;
  estado_anterior: string | null;
  estado_nuevo: string;
  changed_at: string;
  changed_by: string | null;
  username: string | null;
};

export const formatAuditEstadoLabel = (raw: string | null): string => {
  if (!raw) return "—";
  const parsed = parseCeroRotacionEstado(raw);
  return parsed ? CERO_ROTACION_ESTADO_LABELS[parsed] : raw;
};

export const formatAuditContextLabel = (raw: string) =>
  raw === "restock" ? "Restock" : "Cero rot.";

export const auditChangedAtDateKeyBogota = (changedAtIso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(changedAtIso));
