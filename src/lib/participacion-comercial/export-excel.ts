import * as ExcelJS from "exceljs";
import { PARTICIPACION_LEVEL_NAMES } from "@/lib/participacion-comercial/format";
import type {
  ParticipacionDrillPayload,
  ParticipacionDrillStep,
  ParticipacionMatrixPayload,
  ParticipacionOrientation,
} from "@/lib/participacion-comercial/types";
import { sanitizeExportText } from "@/lib/shared/export-utils";

const HEADER_FILL = "FF1E3A5F";
const HEADER_FONT = "FFFFFFFF";
const TITLE_FILL = "FF1D4ED8";
const META_FILL = "FFEFF6FF";
const ALT_ROW = "FFF8FAFC";
const TOTAL_FILL = "FFE2E8F0";
const RESIDUAL_FILL = "FFF1F5F9";
const BORDER = "FFCBD5E1";

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

/** Verde (alta) → ámbar → rojo (baja) en ARGB sólido. */
export const shareHeatArgb = (pct: number): { fill: string; font: string } => {
  if (!Number.isFinite(pct) || pct <= 0) {
    return { fill: "FFF1F5F9", font: "FF94A3B8" };
  }
  const t = Math.max(0, Math.min(1, pct / 30));
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.5) {
    const u = t / 0.5;
    r = Math.round(198 + (234 - 198) * u);
    g = Math.round(40 + (179 - 40) * u);
    b = Math.round(56 + (8 - 56) * u);
  } else {
    const u = (t - 0.5) / 0.5;
    r = Math.round(234 + (14 - 234) * u);
    g = Math.round(179 + (138 - 179) * u);
    b = Math.round(8 + (77 - 8) * u);
  }
  const toHex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  const fillArgb = `FF${toHex(r)}${toHex(g)}${toHex(b)}`;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return {
    fill: fillArgb,
    font: luminance < 0.55 ? "FFFFFFFF" : "FF1E293B",
  };
};

const pathLabel = (path: ParticipacionDrillStep[]) =>
  path.length === 0
    ? "Raíz"
    : path.map((step) => sanitizeExportText(step.label)).join(" › ");

const lineDisplay = (id: string, label: string, residual?: boolean) => {
  if (residual) return sanitizeExportText(label);
  if (!id || id.startsWith("__")) return sanitizeExportText(label);
  return sanitizeExportText(`${id} · ${label}`);
};

export type ParticipacionExcelInput = {
  dateStart: string;
  dateEnd: string;
  orientation: ParticipacionOrientation;
  drill: ParticipacionDrillPayload;
  matrix: ParticipacionMatrixPayload | null;
  path: ParticipacionDrillStep[];
};

export const participacionExcelFilename = (
  dateStart: string,
  dateEnd: string,
  orientation: ParticipacionOrientation,
): string => {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  return `participacion-comercial_${orientation}_${dateStart}_${dateEnd}_${stamp}.xlsx`;
};

export const writeParticipacionWorkbook = async (
  input: ParticipacionExcelInput,
): Promise<ArrayBuffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Visor Productividad";
  workbook.created = new Date();

  writePortadaSheet(workbook, input);
  writeDrillSheet(workbook, input);
  if (input.matrix && input.matrix.rows.length > 0) {
    writeMatrixPctSheet(workbook, input);
    writeMatrixSalesSheet(workbook, input);
  }

  return workbook.xlsx.writeBuffer();
};

export const downloadParticipacionExcel = async (
  input: ParticipacionExcelInput & { filename?: string },
): Promise<{ fileName: string; byteSize: number; rowCount: number }> => {
  const buffer = await writeParticipacionWorkbook(input);
  const fileName =
    input.filename ??
    participacionExcelFilename(
      input.dateStart,
      input.dateEnd,
      input.orientation,
    );
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
    rowCount: input.drill.rows.length + (input.matrix?.rows.length ?? 0),
  };
};

const writePortadaSheet = (
  workbook: ExcelJS.Workbook,
  input: ParticipacionExcelInput,
) => {
  const sheet = workbook.addWorksheet("Portada", {
    views: [{ showGridLines: false }],
  });
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 56;

  sheet.mergeCells(1, 1, 1, 2);
  const title = sheet.getCell(1, 1);
  title.value = "Participación comercial";
  title.font = { bold: true, size: 16, color: { argb: HEADER_FONT } };
  fill(title, TITLE_FILL);
  title.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 32;

  const rows: Array<[string, string]> = [
    ["Periodo", `${input.dateStart} → ${input.dateEnd}`],
    [
      "Orientación",
      input.orientation === "sede" ? "Por sede" : "Por línea",
    ],
    ["Nivel drill", PARTICIPACION_LEVEL_NAMES[input.drill.level]],
    ["Ruta drill", pathLabel(input.path)],
    ["Total nivel ($)", Math.round(input.drill.parentTotalSales).toLocaleString("es-CO")],
    ["Filas drill", String(input.drill.rows.length)],
    ["Líneas en matriz", String(input.matrix?.rows.length ?? 0)],
    ["Sedes en matriz", String(input.matrix?.columns.length ?? 0)],
    [
      "Venta total matriz ($)",
      Math.round(input.matrix?.grandTotalSales ?? 0).toLocaleString("es-CO"),
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
    "Hojas: Portada · Drill · Matriz % · Matriz venta $";
  sheet.getCell(rows.length + 5, 1).font = {
    italic: true,
    size: 9,
    color: { argb: "FF64748B" },
  };
};

const writeDrillSheet = (
  workbook: ExcelJS.Workbook,
  input: ParticipacionExcelInput,
) => {
  const sheet = workbook.addWorksheet("Drill", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  const headers = [
    "Nivel",
    "Código / ID",
    "Nombre",
    "Venta $",
    "Unidades",
    "Participación %",
    "Hijos",
  ];
  const widths = [12, 16, 42, 16, 12, 14, 8];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  sheet.mergeCells(1, 1, 1, headers.length);
  const banner = sheet.getCell(1, 1);
  banner.value = `Drill · ${PARTICIPACION_LEVEL_NAMES[input.drill.level]} · ${pathLabel(input.path)}`;
  banner.font = { bold: true, size: 11, color: { argb: HEADER_FONT } };
  fill(banner, HEADER_FILL);
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

  const sorted = [...input.drill.rows].sort((a, b) => b.sales - a.sales);

  sorted.forEach((row, index) => {
    const excelRow = sheet.getRow(index + 3);
    const name =
      row.level === "linea"
        ? lineDisplay(row.id, row.label)
        : sanitizeExportText(row.label);
    const values: Array<string | number> = [
      PARTICIPACION_LEVEL_NAMES[row.level],
      sanitizeExportText(row.id),
      name,
      Math.round(row.sales),
      Math.round(row.units * 10) / 10,
      Math.round(row.sharePct * 10) / 10,
      row.childCount,
    ];
    values.forEach((value, col) => {
      const cell = excelRow.getCell(col + 1);
      cell.value = value;
      border(cell);
      cell.font = { size: 9 };
      if (index % 2 === 1) fill(cell, ALT_ROW);
      if (col === 3) {
        cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "right" };
      }
      if (col === 4) {
        cell.numFmt = "#,##0.0";
        cell.alignment = { horizontal: "right" };
      }
      if (col === 5) {
        const colors = shareHeatArgb(row.sharePct);
        fill(cell, colors.fill);
        cell.font = { size: 9, bold: true, color: { argb: colors.font } };
        cell.numFmt = '0.0"%"';
        cell.alignment = { horizontal: "center" };
      }
      if (col === 6) cell.alignment = { horizontal: "center" };
    });
  });

  const totalRow = sheet.getRow(sorted.length + 3);
  for (let col = 1; col <= headers.length; col += 1) {
    fill(totalRow.getCell(col), TOTAL_FILL);
    border(totalRow.getCell(col));
    totalRow.getCell(col).font = { bold: true, size: 9 };
  }
  totalRow.getCell(1).value = "TOTAL nivel";
  totalRow.getCell(3).value = pathLabel(input.path);
  totalRow.getCell(4).value = Math.round(input.drill.parentTotalSales);
  totalRow.getCell(4).numFmt = "#,##0";
  totalRow.getCell(6).value = 100;
  totalRow.getCell(6).numFmt = '0"%"';
};

const writeMatrixPctSheet = (
  workbook: ExcelJS.Workbook,
  input: ParticipacionExcelInput,
) => {
  const matrix = input.matrix!;
  const sheet = workbook.addWorksheet("Matriz %", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 2 }],
  });

  sheet.getColumn(1).width = 36;
  matrix.columns.forEach((_, index) => {
    sheet.getColumn(index + 2).width = 11;
  });

  const lastCol = 1 + matrix.columns.length;
  sheet.mergeCells(1, 1, 1, lastCol);
  const banner = sheet.getCell(1, 1);
  banner.value =
    "Matriz línea × sede · % participación dentro de cada sede (columna ≈ 100%)";
  banner.font = { bold: true, size: 11, color: { argb: HEADER_FONT } };
  fill(banner, HEADER_FILL);
  sheet.getRow(1).height = 22;

  const headerRow = sheet.getRow(2);
  const labelHeader = headerRow.getCell(1);
  labelHeader.value = "Línea";
  labelHeader.font = { bold: true, size: 9, color: { argb: HEADER_FONT } };
  fill(labelHeader, HEADER_FILL);
  border(labelHeader);

  matrix.columns.forEach((col, index) => {
    const cell = headerRow.getCell(index + 2);
    cell.value = sanitizeExportText(col.label);
    cell.font = { bold: true, size: 8, color: { argb: HEADER_FONT } };
    fill(cell, HEADER_FILL);
    border(cell);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  headerRow.height = 30;

  const cellMap = new Map<string, { pct: number; sales: number }>();
  for (const cell of matrix.cells) {
    cellMap.set(`${cell.rowId}::${cell.sedeKey}`, {
      pct: cell.shareOfSedePct,
      sales: cell.sales,
    });
  }

  matrix.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + 3);
    const labelCell = excelRow.getCell(1);
    labelCell.value = lineDisplay(row.id, row.label, row.residual);
    labelCell.font = { size: 9, bold: true };
    fill(labelCell, row.residual ? RESIDUAL_FILL : ALT_ROW);
    border(labelCell);

    matrix.columns.forEach((col, colIndex) => {
      const data = cellMap.get(`${row.id}::${col.key}`);
      const cell = excelRow.getCell(colIndex + 2);
      border(cell);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      if (!data) {
        cell.value = "—";
        fill(cell, "FFF1F5F9");
        cell.font = { size: 8, color: { argb: "FF94A3B8" } };
        return;
      }
      cell.value = Math.round(data.pct * 10) / 10;
      cell.numFmt = '0.0"%"';
      const colors = shareHeatArgb(data.pct);
      fill(cell, colors.fill);
      cell.font = { size: 9, bold: true, color: { argb: colors.font } };
    });
  });

  const totalRow = sheet.getRow(matrix.rows.length + 3);
  totalRow.getCell(1).value = "Total sede";
  totalRow.getCell(1).font = { bold: true, size: 9 };
  fill(totalRow.getCell(1), TOTAL_FILL);
  border(totalRow.getCell(1));
  matrix.columns.forEach((col, colIndex) => {
    const cell = totalRow.getCell(colIndex + 2);
    cell.value = 100;
    cell.numFmt = '0"%"';
    cell.font = { bold: true, size: 9 };
    fill(cell, TOTAL_FILL);
    border(cell);
    cell.alignment = { horizontal: "center" };
    const sedeTotal = matrix.sedeTotals?.find((entry) => entry.sedeKey === col.key);
    if (sedeTotal) {
      cell.note = `Venta sede: ${Math.round(sedeTotal.sales).toLocaleString("es-CO")}`;
    }
  });
};

const writeMatrixSalesSheet = (
  workbook: ExcelJS.Workbook,
  input: ParticipacionExcelInput,
) => {
  const matrix = input.matrix!;
  const sheet = workbook.addWorksheet("Matriz venta $", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 2 }],
  });

  sheet.getColumn(1).width = 36;
  matrix.columns.forEach((_, index) => {
    sheet.getColumn(index + 2).width = 13;
  });

  const lastCol = 1 + matrix.columns.length;
  sheet.mergeCells(1, 1, 1, lastCol);
  const banner = sheet.getCell(1, 1);
  banner.value = "Matriz línea × sede · venta $ (sin impuesto)";
  banner.font = { bold: true, size: 11, color: { argb: HEADER_FONT } };
  fill(banner, HEADER_FILL);
  sheet.getRow(1).height = 22;

  const headerRow = sheet.getRow(2);
  const labelHeader = headerRow.getCell(1);
  labelHeader.value = "Línea";
  labelHeader.font = { bold: true, size: 9, color: { argb: HEADER_FONT } };
  fill(labelHeader, HEADER_FILL);
  border(labelHeader);

  matrix.columns.forEach((col, index) => {
    const cell = headerRow.getCell(index + 2);
    cell.value = sanitizeExportText(col.label);
    cell.font = { bold: true, size: 8, color: { argb: HEADER_FONT } };
    fill(cell, HEADER_FILL);
    border(cell);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  headerRow.height = 30;

  const cellMap = new Map<string, number>();
  for (const cell of matrix.cells) {
    cellMap.set(`${cell.rowId}::${cell.sedeKey}`, cell.sales);
  }

  matrix.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + 3);
    const labelCell = excelRow.getCell(1);
    labelCell.value = lineDisplay(row.id, row.label, row.residual);
    labelCell.font = { size: 9, bold: true };
    fill(labelCell, row.residual ? RESIDUAL_FILL : ALT_ROW);
    border(labelCell);

    matrix.columns.forEach((col, colIndex) => {
      const sales = cellMap.get(`${row.id}::${col.key}`);
      const cell = excelRow.getCell(colIndex + 2);
      border(cell);
      cell.alignment = { horizontal: "right", vertical: "middle" };
      if (sales === undefined) {
        cell.value = "—";
        fill(cell, "FFF1F5F9");
        cell.font = { size: 8, color: { argb: "FF94A3B8" } };
        return;
      }
      cell.value = Math.round(sales);
      cell.numFmt = "#,##0";
      cell.font = { size: 9 };
      if (rowIndex % 2 === 1) fill(cell, ALT_ROW);
    });
  });

  const totalRow = sheet.getRow(matrix.rows.length + 3);
  totalRow.getCell(1).value = "Total sede";
  totalRow.getCell(1).font = { bold: true, size: 9 };
  fill(totalRow.getCell(1), TOTAL_FILL);
  border(totalRow.getCell(1));
  matrix.columns.forEach((col, colIndex) => {
    const cell = totalRow.getCell(colIndex + 2);
    const sedeTotal =
      matrix.sedeTotals?.find((entry) => entry.sedeKey === col.key)?.sales ?? 0;
    cell.value = Math.round(sedeTotal);
    cell.numFmt = "#,##0";
    cell.font = { bold: true, size: 9 };
    fill(cell, TOTAL_FILL);
    border(cell);
    cell.alignment = { horizontal: "right" };
  });
};
