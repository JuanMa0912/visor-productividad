export type FactNavStep =
  | { type: "fecha"; fecha: string; label: string }
  | { type: "tipo"; id: string; label: string }
  | { type: "factura"; documento: string; tipdoc: string; label: string };

export const parseFactPath = (raw: string | null): FactNavStep[] => {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as FactNavStep[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const factPathSqlFilters = (
  path: FactNavStep[],
  params: unknown[],
): string[] => {
  const parts: string[] = [];
  const fecha = path.find((step) => step.type === "fecha");
  if (fecha?.type === "fecha") {
    params.push(fecha.fecha);
    parts.push(`fecha_dcto = $${params.length}`);
  }
  const tipo = path.find((step) => step.type === "tipo");
  if (tipo?.type === "tipo") {
    params.push(tipo.id);
    parts.push(`TRIM(COALESCE(id_tipo::text, '')) = $${params.length}`);
  }
  const factura = path.find((step) => step.type === "factura");
  if (factura?.type === "factura") {
    params.push(factura.documento, factura.tipdoc);
    parts.push(
      `TRIM(COALESCE(documento_fc::text, '')) = $${params.length - 1}`,
      `TRIM(COALESCE(id_tipdoc_fc::text, '')) = $${params.length}`,
    );
  }
  return parts;
};
