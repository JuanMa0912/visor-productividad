import * as ExcelJS from "exceljs";
import {
  formatDiDays,
  NO_SALES_DI_VALUE,
  resolveDiBand,
} from "@/lib/analisis-inventario/di";
import {
  ANALISIS_INVENTARIO_LINE_FAMILY_LABELS,
  type AnalisisInventarioLineFamily,
} from "@/lib/analisis-inventario/line-family";
import { ANALISIS_INVENTARIO_LEVEL_NAMES } from "@/lib/analisis-inventario/drill-path";
import type {
  AnalisisInventarioDrillPayload,
  AnalisisInventarioDrillStep,
  AnalisisInventarioHeatmapPayload,
  AnalisisInventarioMetric,
} from "@/lib/analisis-inventario/types";
import { sanitizeExportText } from "@/lib/shared/export-utils";

const HEADER_FILL = "FF1E3A5F";
const HEADER_FONT = "FFFFFFFF";
const TITLE_FILL = "FF1D4ED8";
const META_FILL = "FFEFF6FF";
const ALT_ROW = "FFF8FAFC";
const TOTAL_FILL = "FFE2E8F0";
const BORDER = "FFCBD5E1";

const BAND_FILL: Record<string, string> = {
  alta: "FFD1FAE5",
  normal: "FFE0F2FE",
  revisar: "FFFEF3C7",
  sobrestock: "FFFFE4E6",
  "sin-venta": "FFE2E8F0",
  cero: "FFF8FAFC",
};

const BAND_FONT: Record<string, string> = {
  alta: "FF065F46",
  normal: "FF075985",
  revisar: "FF92400E",
  sobrestock: "FF9F1239",
  "sin-venta": "FF64748B",
  cero: "FF94A3B8",
};

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BORDER } },
  left: { style: "thin", color: { argb: BORDER } },
  bottom: { style: "thin", color: { argb: BORDER } },
  right: { style: "thin", color: { argb: BORDER } },
};

const fill = (cell: ExcelJS.Cell, argb: string) => {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
};

const border = (cell: ExcelJS.Cell) => {
  cell.border = thinBorder;
};

const diExcelValue = (value: number): number | string => {
  if (!Number.isFinite(value) || value >= NO_SALES_DI_VALUE) return "Sin venta";
  return Math.round(value * 10) / 10;
};

const pathLabel = (path: AnalisisInventarioDrillStep[]) =>
  path.length === 0
    ? "Raíz"
    : path.map((step) => sanitizeExportText(step.label)).join(" › ");

export type AnalisisInventarioExcelInput = {
  dateStart: string;
  dateEnd: string;
  metric: AnalisisInventarioMetric;
  lineFamily: AnalisisInventarioLineFamily;
  drill: AnalisisInventarioDrillPayload;
  heatmap: AnalisisInventarioHeatmapPayload | null;
  drillPath: AnalisisInventarioDrillStep[];
  heatmapPath: AnalisisInventarioDrillStep[];
};

export const analisisInventarioExcelFilename = (
  dateStart: string,
  dateEnd: string,
): string => {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  return `dias-inventario_${dateStart}_${dateEnd}_${stamp}.xlsx`;
};

export const writeAnalisisInventarioWorkbook = async (
  input: AnalisisInventarioExcelInput,
): Promise<ArrayBuffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Visor Productividad";
  workbook.created = new Date();

  writePortadaSheet(workbook, input);
  writeDrillSheet(workbook, input);
  if (input.heatmap && input.heatmap.rows.length > 0) {
    writeHeatmapSheet(workbook, input);
  }
  writeLeyendaSheet(workbook);

  return workbook.xlsx.writeBuffer();
};

export const downloadAnalisisInventarioExcel = async (
  input: AnalisisInventarioExcelInput & { filename?: string },
): Promise<{ fileName: string; byteSize: number; rowCount: number }> => {
  const buffer = await writeAnalisisInventarioWorkbook(input);
  const fileName =
    input.filename ??
    analisisInventarioExcelFilename(input.dateStart, input.dateEnd);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return {
    fileName,
    byteSize: blob.size,
    rowCount: input.drill.rows.length + (input.heatmap?.rows.length ?? 0),
  };
};

const writePortadaSheet = (
  workbook: ExcelJS.Workbook,
  input: AnalisisInventarioExcelInput,
) => {
  const sheet = workbook.addWorksheet("Portada", {
    views: [{ showGridLines: false }],
  });
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 56;

  sheet.mergeCells(1, 1, 1, 2);
  const title = sheet.getCell(1, 1);
  title.value = "Días de inventario";
  title.font = { bold: true, size: 16, color: { argb: HEADER_FONT } };
  fill(title, TITLE_FILL);
  title.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 32;

  const rows: Array<[string, string]> = [
    ["Periodo", `${input.dateStart} → ${input.dateEnd}`],
    [
      "Métrica mapa",
      input.metric === "units" ? "DI unidades" : "DI valor",
    ],
    [
      "Familia de líneas",
      ANALISIS_INVENTARIO_LINE_FAMILY_LABELS[input.lineFamily],
    ],
    ["Nivel drill", ANALISIS_INVENTARIO_LEVEL_NAMES[input.drill.level]],
    ["Ruta drill", pathLabel(input.drillPath)],
    ["Ruta mapa", pathLabel(input.heatmapPath)],
    ["Filas drill", String(input.drill.rows.length)],
    [
      "Filas mapa",
      String(input.heatmap?.rows.length ?? 0),
    ],
    ["Generado", new Date().toLocaleString("es-CO")],
  ];

  rows.forEach(([label, value], index) => {
    const excelRow = sheet.getRow(index + 3);
    const labelCell = excelRow.getCell(1);
    const valueCell = excelRow.getCell(2);
    labelCell.value = label;
    labelCell.font = { bold: true, size: 10, color: { argb: "FF334155" } };
    fill(labelCell, META_FILL);
    border(labelCell);
    valueCell.value = value;
    border(valueCell);
  });

  sheet.getCell(rows.length + 5, 1).value =
    "Hojas: Portada · Drill · Mapa de calor · Leyenda DI";
  sheet.getCell(rows.length + 5, 1).font = {
    italic: true,
    size: 9,
    color: { argb: "FF64748B" },
  };
};

const writeDrillSheet = (
  workbook: ExcelJS.Workbook,
  input: AnalisisInventarioExcelInput,
) => {
  const sheet = workbook.addWorksheet("Drill", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  const headers = [
    "Nivel",
    "Código / ID",
    "Nombre",
    "DI und. (días)",
    "DI valor (días)",
    "Inv. und.",
    "Inv. $",
    "Venta und.",
    "Costo venta $",
    "Hijos",
  ];

  const widths = [12, 16, 42, 14, 14, 12, 16, 12, 16, 8];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  sheet.mergeCells(1, 1, 1, headers.length);
  const banner = sheet.getCell(1, 1);
  banner.value = `Drill · ${ANALISIS_INVENTARIO_LEVEL_NAMES[input.drill.level]} · ${pathLabel(input.drillPath)}`;
  banner.font = { bold: true, size: 11, color: { argb: HEADER_FONT } };
  fill(banner, HEADER_FILL);
  banner.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 22;

  const headerRow = sheet.getRow(2);
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, size: 9, color: { argb: HEADER_FONT } };
    fill(cell, HEADER_FILL);
    border(cell);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  headerRow.height = 28;

  const sorted = [...input.drill.rows].sort(
    (a, b) => b.inventoryValue - a.inventoryValue,
  );

  sorted.forEach((row, index) => {
    const excelRow = sheet.getRow(index + 3);
    const values: Array<string | number> = [
      ANALISIS_INVENTARIO_LEVEL_NAMES[row.level],
      sanitizeExportText(row.id),
      sanitizeExportText(row.label),
      diExcelValue(row.diUnits),
      diExcelValue(row.diValue),
      Math.round(row.inventoryUnits * 10) / 10,
      Math.round(row.inventoryValue),
      Math.round(row.soldUnits * 10) / 10,
      Math.round(row.costOfSales),
      row.childCount,
    ];
    values.forEach((value, col) => {
      const cell = excelRow.getCell(col + 1);
      cell.value = value;
      border(cell);
      cell.font = { size: 9 };
      if (index % 2 === 1) fill(cell, ALT_ROW);
      if (col === 3 || col === 4) {
        const di = col === 3 ? row.diUnits : row.diValue;
        const band = resolveDiBand(di);
        fill(cell, BAND_FILL[band] ?? ALT_ROW);
        cell.font = {
          size: 9,
          bold: true,
          color: { argb: BAND_FONT[band] ?? "FF1E293B" },
        };
        cell.alignment = { horizontal: "center" };
      }
      if (col >= 5 && col <= 8 && typeof value === "number") {
        cell.numFmt = col === 5 || col === 7 ? "#,##0.0" : "#,##0";
        cell.alignment = { horizontal: "right" };
      }
      if (col === 9) cell.alignment = { horizontal: "center" };
    });
  });

  const totalRow = sheet.getRow(sorted.length + 3);
  totalRow.getCell(1).value = "TOTAL nivel";
  totalRow.getCell(1).font = { bold: true, size: 9 };
  const invU = sorted.reduce((sum, row) => sum + row.inventoryUnits, 0);
  const invV = sorted.reduce((sum, row) => sum + row.inventoryValue, 0);
  const sold = sorted.reduce((sum, row) => sum + row.soldUnits, 0);
  const cost = sorted.reduce((sum, row) => sum + row.costOfSales, 0);
  [
    "",
    "",
    "",
    "",
    Math.round(invU * 10) / 10,
    Math.round(invV),
    Math.round(sold * 10) / 10,
    Math.round(cost),
    "",
  ].forEach((value, offset) => {
    const cell = totalRow.getCell(offset + 2);
    cell.value = value;
    cell.font = { bold: true, size: 9 };
    fill(cell, TOTAL_FILL);
    border(cell);
  });
  for (let col = 1; col <= headers.length; col += 1) {
    fill(totalRow.getCell(col), TOTAL_FILL);
    border(totalRow.getCell(col));
  }
};

const writeHeatmapSheet = (
  workbook: ExcelJS.Workbook,
  input: AnalisisInventarioExcelInput,
) => {
  const heatmap = input.heatmap!;
  const metricKey = input.metric === "units" ? "diUnits" : "diValue";
  const sheet = workbook.addWorksheet("Mapa de calor", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 2 }],
  });

  sheet.getColumn(1).width = 36;
  heatmap.columns.forEach((_, index) => {
    sheet.getColumn(index + 2).width = 12;
  });

  const lastCol = 1 + heatmap.columns.length;
  sheet.mergeCells(1, 1, 1, lastCol);
  const banner = sheet.getCell(1, 1);
  banner.value = `Mapa de calor · ${
    input.metric === "units" ? "DI unidades" : "DI valor"
  } · ${pathLabel(input.heatmapPath)}`;
  banner.font = { bold: true, size: 11, color: { argb: HEADER_FONT } };
  fill(banner, HEADER_FILL);
  sheet.getRow(1).height = 22;

  const headerRow = sheet.getRow(2);
  const labelHeader = headerRow.getCell(1);
  labelHeader.value = ANALISIS_INVENTARIO_LEVEL_NAMES[heatmap.rowLevel];
  labelHeader.font = { bold: true, size: 9, color: { argb: HEADER_FONT } };
  fill(labelHeader, HEADER_FILL);
  border(labelHeader);

  heatmap.columns.forEach((col, index) => {
    const cell = headerRow.getCell(index + 2);
    cell.value = sanitizeExportText(col.label);
    cell.font = { bold: true, size: 8, color: { argb: HEADER_FONT } };
    fill(cell, HEADER_FILL);
    border(cell);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  headerRow.height = 30;

  const cellMap = new Map<string, number>();
  for (const cell of heatmap.cells) {
    cellMap.set(`${cell.rowId}::${cell.sedeKey}`, cell[metricKey]);
  }

  heatmap.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + 3);
    const labelCell = excelRow.getCell(1);
    labelCell.value = sanitizeExportText(row.label);
    labelCell.font = { size: 9, bold: true };
    fill(labelCell, ALT_ROW);
    border(labelCell);

    heatmap.columns.forEach((col, colIndex) => {
      const di = cellMap.get(`${row.id}::${col.key}`);
      const cell = excelRow.getCell(colIndex + 2);
      border(cell);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      if (di === undefined || !Number.isFinite(di)) {
        cell.value = "—";
        fill(cell, "FFF1F5F9");
        cell.font = { size: 8, color: { argb: "FF94A3B8" } };
        return;
      }
      cell.value = diExcelValue(di);
      const band = resolveDiBand(di);
      fill(cell, BAND_FILL[band] ?? ALT_ROW);
      cell.font = {
        size: 9,
        bold: true,
        color: { argb: BAND_FONT[band] ?? "FF1E293B" },
      };
      if (typeof cell.value === "number") cell.numFmt = "0.0";
    });
  });
};

const writeLeyendaSheet = (workbook: ExcelJS.Workbook) => {
  const sheet = workbook.addWorksheet("Leyenda DI");
  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 36;

  const title = sheet.getCell(1, 1);
  title.value = "Leyenda de días de inventario";
  title.font = { bold: true, size: 12, color: { argb: HEADER_FONT } };
  fill(title, HEADER_FILL);
  sheet.mergeCells(1, 1, 1, 2);

  const bands: Array<[string, string, string]> = [
    ["alta", "< 15 días", "Rotación alta"],
    ["normal", "15 – 35 días", "Normal"],
    ["revisar", "35 – 60 días", "Revisar"],
    ["sobrestock", "> 60 días", "Sobrestock"],
    ["sin-venta", "Sin venta", "Hay inventario sin salida en el periodo"],
    ["cero", "0 días", "Sin inventario"],
  ];

  bands.forEach(([band, range, note], index) => {
    const row = sheet.getRow(index + 3);
    const a = row.getCell(1);
    const b = row.getCell(2);
    a.value = range;
    b.value = note;
    fill(a, BAND_FILL[band]!);
    a.font = { bold: true, color: { argb: BAND_FONT[band]! } };
    border(a);
    border(b);
  });

  sheet.getCell(bands.length + 5, 1).value =
    `Ejemplo formato: ${formatDiDays(12.4)} · ${formatDiDays(NO_SALES_DI_VALUE)}`;
  sheet.getCell(bands.length + 5, 1).font = {
    italic: true,
    size: 9,
    color: { argb: "FF64748B" },
  };
};
