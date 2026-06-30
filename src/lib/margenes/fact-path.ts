import type { DrillPathStep } from "@/lib/margenes/drill-path";

import type { MargenDataTable } from "@/lib/margenes/margen-data-source";
import { isRollTable } from "@/lib/margenes/margen-data-source";

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
  table: MargenDataTable = "margen_final",
): string[] => {
  const parts: string[] = [];
  const idTipo = isRollTable(table) ? "id_tipo" : `TRIM(COALESCE(id_tipo::text, ''))`;
  const documentoFc = isRollTable(table)
    ? "documento_fc"
    : `TRIM(COALESCE(documento_fc::text, ''))`;
  const tipdocFc = isRollTable(table)
    ? "id_tipdoc_fc"
    : `TRIM(COALESCE(id_tipdoc_fc::text, ''))`;

  const fecha = path.find((step) => step.type === "fecha");
  if (fecha?.type === "fecha") {
    params.push(fecha.fecha);
    parts.push(`fecha_dcto = $${params.length}`);
  }
  const tipo = path.find((step) => step.type === "tipo");
  if (tipo?.type === "tipo") {
    params.push(tipo.id);
    parts.push(`${idTipo} = $${params.length}`);
  }
  const factura = path.find((step) => step.type === "factura");
  if (factura?.type === "factura") {
    params.push(factura.documento, factura.tipdoc);
    parts.push(
      `${documentoFc} = $${params.length - 1}`,
      `${tipdocFc} = $${params.length}`,
    );
  }
  return parts;
};

export const isInvoiceDetailFactPath = (path: FactNavStep[]): boolean =>
  path.some((step) => step.type === "factura");

export const factPathToInvoiceKpiDrillPath = (
  path: FactNavStep[],
): DrillPathStep[] => {
  const factura = path.find((step) => step.type === "factura");
  if (factura?.type !== "factura") return [];
  return [
    {
      type: "factura",
      documento: factura.documento,
      tipdoc: factura.tipdoc,
      label: factura.label,
    },
  ];
};
