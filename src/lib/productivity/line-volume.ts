import { buildInformeCategoriaLabel, buildInformeItemLabel, buildInformeLineaLabel } from "@/lib/informe-variacion/labels";
import {
  convertAsaderoQtyToPollosUnd,
  shouldConvertAsaderoToPollosUnd,
} from "@/lib/informe-variacion/asadero-pollos-und";
import type { Linekey, LineMetrics } from "@/types";

export type ProductivityVolumeKind = "tx" | "und" | "kg" | "asadero";

const padLineCode = (raw: string): string => {
  const value = String(raw ?? "").trim();
  if (/^\d+$/.test(value)) return value.padStart(2, "0");
  return value;
};

/**
 * Mapea el roll de margen (id_tipo + N1) a la tarjeta de productividad.
 * Alineado con ETL ventas_*: Fruver 01 / Carnes 02 / Pollo-pescado 03-04 /
 * resto cat. 4 = industria. Cat. 3 = asadero.
 */
export const resolveProductivityLineFromRoll = (
  idTipo: string,
  idLinea1: string,
): Linekey | null => {
  const tipo = String(idTipo ?? "").trim();
  const n1 = padLineCode(idLinea1);
  if (tipo === "3") return "asadero";
  if (tipo !== "4") return null;
  if (n1 === "01") return "fruver";
  if (n1 === "02") return "carnes";
  if (n1 === "03" || n1 === "04") return "pollo y pescado";
  return "industria";
};

export const volumeKindForLine = (
  lineId: string,
): ProductivityVolumeKind | null => {
  const id = lineId.trim().toLowerCase();
  if (id === "cajas") return "tx";
  if (id === "industria") return "und";
  if (id === "fruver" || id === "carnes" || id === "pollo y pescado") {
    return "kg";
  }
  if (id === "asadero") return "asadero";
  return null;
};

export const emptyLineMetrics = (
  id: Linekey,
  name: string,
  hourlyRate = 50_000,
): LineMetrics => ({
  id,
  name,
  sales: 0,
  hours: 0,
  hourlyRate,
  volume: 0,
  transactions: 0,
  asaderoPollosUnd: 0,
  asaderoOtherUnd: 0,
});

export const lineHasActivity = (line: LineMetrics): boolean =>
  line.sales !== 0 ||
  line.hours !== 0 ||
  (line.volume ?? 0) !== 0 ||
  (line.transactions ?? 0) !== 0 ||
  (line.asaderoPollosUnd ?? 0) !== 0 ||
  (line.asaderoOtherUnd ?? 0) !== 0;

/** Cache viejo (solo sales/hours) no sirve para las tarjetas de volumen. */
export const hasProductivityVolumeShape = (
  dailyData: Array<{ lines: LineMetrics[] }>,
): boolean => {
  for (const day of dailyData) {
    for (const line of day.lines) {
      if (
        typeof line.volume === "number" ||
        typeof line.transactions === "number" ||
        typeof line.asaderoPollosUnd === "number" ||
        typeof line.asaderoOtherUnd === "number"
      ) {
        return true;
      }
    }
  }
  return false;
};

export type AsaderoQtySplit = {
  pollosUnd: number;
  otherUnd: number;
};

/** Misma puerta que Informe Variación: sublínea 01 POLLO → pollos und; el resto crudo. */
export const splitAsaderoQty = (args: {
  idTipo: string;
  idLinea1: string;
  idLinea2: string;
  nombreLinea1: string;
  nombreLinea2: string;
  idItem: string;
  itemDescripcion: string;
  cantidad: number;
}): AsaderoQtySplit => {
  const qty = Number(args.cantidad) || 0;
  const catLabel = buildInformeCategoriaLabel(args.idTipo);
  const linLabel = buildInformeLineaLabel(args.idLinea1, args.nombreLinea1);
  const subLabel = buildInformeLineaLabel(args.idLinea2, args.nombreLinea2);
  const itemLabel = buildInformeItemLabel(args.idItem, args.itemDescripcion);
  if (shouldConvertAsaderoToPollosUnd(catLabel, linLabel, subLabel)) {
    const pollosUnd = convertAsaderoQtyToPollosUnd(
      qty,
      itemLabel,
      "",
      linLabel,
      subLabel,
    );
    return {
      pollosUnd,
      otherUnd: pollosUnd === 0 && qty !== 0 ? qty : 0,
    };
  }
  return { pollosUnd: 0, otherUnd: qty };
};
