export type DrillPathStep =
  | { type: "day"; fecha: string; label: string }
  | { type: "acum"; label: string }
  | { type: "tipo"; id: string; label: string }
  | { type: "linea1"; id: string; label: string }
  | { type: "linea2"; id: string; label: string }
  | { type: "item"; id: string; label: string }
  | { type: "factura"; documento: string; tipdoc: string; label: string };

export const DRILL_LEVEL_NAMES = [
  "Día",
  "Categoría",
  "Línea",
  "Sublínea",
  "Ítem",
  "Factura",
] as const;

export const parseDrillPath = (raw: string | null): DrillPathStep[] => {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as DrillPathStep[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const drillPathSqlFilters = (
  path: DrillPathStep[],
  params: unknown[],
): string[] => {
  const parts: string[] = [];
  if (path.length === 0) return parts;

  const day = path[0];
  if (day?.type === "day") {
    params.push(day.fecha);
    parts.push(`fecha_dcto = $${params.length}`);
  }

  const tipo = path.find((step) => step.type === "tipo");
  if (tipo?.type === "tipo") {
    params.push(tipo.id);
    parts.push(`TRIM(COALESCE(id_tipo::text, '')) = $${params.length}`);
  }

  const linea1 = path.find((step) => step.type === "linea1");
  if (linea1?.type === "linea1") {
    params.push(linea1.id);
    parts.push(`TRIM(COALESCE(id_linea1::text, '')) = $${params.length}`);
  }

  const linea2 = path.find((step) => step.type === "linea2");
  if (linea2?.type === "linea2") {
    params.push(linea2.id);
    parts.push(`TRIM(COALESCE(id_linea2::text, '')) = $${params.length}`);
  }

  const item = path.find((step) => step.type === "item");
  if (item?.type === "item") {
    params.push(item.id);
    parts.push(`TRIM(COALESCE(id_item::text, '')) = $${params.length}`);
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

/** Al ver el detalle de una factura, solo filtrar por documento + tipdoc (no por ítem/ruta). */
export const drillPathForInvoiceDetail = (
  path: DrillPathStep[],
): DrillPathStep[] => {
  const factura = path.find((step) => step.type === "factura");
  return factura ? [factura] : path;
};

export const isInvoiceDetailDrillPath = (path: DrillPathStep[]): boolean =>
  path.some((step) => step.type === "factura") &&
  path[path.length - 1]?.type === "factura";
