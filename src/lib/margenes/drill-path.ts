import type { MargenDataTable } from "@/lib/margenes/margen-data-source";
import {
  facturaSedeSqlFilters,
  isRollTable,
} from "@/lib/margenes/margen-data-source";

export type DrillPathStep =
  | { type: "day"; fecha: string; label: string }
  | { type: "acum"; label: string }
  | { type: "tipo"; id: string; label: string }
  | { type: "linea1"; id: string; label: string }
  | { type: "linea2"; id: string; label: string }
  | { type: "item"; id: string; label: string }
  | {
      type: "factura";
      documento: string;
      tipdoc: string;
      label: string;
      empresa?: string;
      idCo?: string;
    };

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
  table: MargenDataTable = "margen_final",
): string[] => {
  const parts: string[] = [];
  if (path.length === 0) return parts;

  const idTipo = isRollTable(table) ? "id_tipo" : `TRIM(COALESCE(id_tipo::text, ''))`;
  const idLinea1 = isRollTable(table) ? "id_linea1" : `TRIM(COALESCE(id_linea1::text, ''))`;
  const idLinea2 = isRollTable(table) ? "id_linea2" : `TRIM(COALESCE(id_linea2::text, ''))`;
  const idItem = isRollTable(table) ? "id_item" : `TRIM(COALESCE(id_item::text, ''))`;
  const documentoFc = isRollTable(table)
    ? "documento_fc"
    : `TRIM(COALESCE(documento_fc::text, ''))`;
  const tipdocFc = isRollTable(table)
    ? "id_tipdoc_fc"
    : `TRIM(COALESCE(id_tipdoc_fc::text, ''))`;

  const day = path[0];
  if (day?.type === "day") {
    params.push(day.fecha);
    parts.push(`fecha_dcto = $${params.length}`);
  }

  const tipo = path.find((step) => step.type === "tipo");
  if (tipo?.type === "tipo") {
    params.push(tipo.id);
    parts.push(`${idTipo} = $${params.length}`);
  }

  const linea1 = path.find((step) => step.type === "linea1");
  if (linea1?.type === "linea1") {
    params.push(linea1.id);
    parts.push(`${idLinea1} = $${params.length}`);
  }

  const linea2 = path.find((step) => step.type === "linea2");
  if (linea2?.type === "linea2") {
    params.push(linea2.id);
    parts.push(`${idLinea2} = $${params.length}`);
  }

  const item = path.find((step) => step.type === "item");
  if (item?.type === "item") {
    params.push(item.id);
    parts.push(`${idItem} = $${params.length}`);
  }

  const factura = path.find((step) => step.type === "factura");
  if (factura?.type === "factura") {
    params.push(factura.documento, factura.tipdoc);
    parts.push(
      `${documentoFc} = $${params.length - 1}`,
      `${tipdocFc} = $${params.length}`,
    );
    parts.push(...facturaSedeSqlFilters(factura, params, table));
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
