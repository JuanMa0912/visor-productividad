import * as ExcelJS from "exceljs";
import {
  buildMatrixExportRows,
  heatmapExcelArgb,
  matrixExportMetaLine,
  type BuildMatrixExportOptions,
  type MatrixExportRow,
} from "@/lib/informe-variacion/export-matrix";

const HEADER_FILL = "FF1E3A5F";
const HEADER_FONT = "FFFFFFFF";
const TOTAL_FILL = "FFE2E8F0";
const BORDER_COLOR = "FFCBD5E1";
const LABEL_FILL = "FFF8FAFC";

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BORDER_COLOR } },
  left: { style: "thin", color: { argb: BORDER_COLOR } },
  bottom: { style: "thin", color: { argb: BORDER_COLOR } },
  right: { style: "thin", color: { argb: BORDER_COLOR } },
};

const fillCell = (cell: ExcelJS.Cell, argb: string) => {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
};

const borderCell = (cell: ExcelJS.Cell) => {
  cell.border = thinBorder;
};

export type InformeMatrixExcelOptions = BuildMatrixExportOptions & {
  periodLabel: string;
};

export const writeInformeMatrixWorkbook = async ({
  payload,
  periodLabel,
  metric,
  matrixMode,
  matrixDisplay,
  ...rest
}: InformeMatrixExcelOptions): Promise<ArrayBuffer> => {
  const rows = buildMatrixExportRows({
    payload,
    metric,
    matrixMode,
    matrixDisplay,
    ...rest,
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Visor Productividad";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Matriz sedes", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 4 }],
  });

  const sedeCount = payload.sedes.length;
  const lastCol = 1 + sedeCount;

  sheet.getColumn(1).width = 42;
  for (let index = 0; index < sedeCount; index += 1) {
    sheet.getColumn(index + 2).width = 11;
  }

  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = "Matriz comparativa entre sedes";
  titleCell.font = { bold: true, size: 14, color: { argb: HEADER_FONT } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
  titleCell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 28;

  sheet.mergeCells(2, 1, 2, lastCol);
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = matrixExportMetaLine(periodLabel, metric, matrixMode, matrixDisplay);
  subtitleCell.font = { size: 10, color: { argb: "FF1E293B" } };
  subtitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
  sheet.getRow(2).height = 20;

  sheet.mergeCells(3, 1, 3, lastCol);
  const metaCell = sheet.getCell(3, 1);
  metaCell.value = `Generado: ${new Date().toLocaleString("es-CO")}`;
  metaCell.font = { size: 9, italic: true, color: { argb: "FF64748B" } };
  metaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  sheet.getRow(3).height = 18;

  const headerRow = sheet.getRow(4);
  const labelHeader = headerRow.getCell(1);
  labelHeader.value = "Categoria / Linea / Sublinea / Item";
  labelHeader.font = { bold: true, color: { argb: HEADER_FONT }, size: 9 };
  fillCell(labelHeader, HEADER_FILL);
  borderCell(labelHeader);
  labelHeader.alignment = { vertical: "middle", wrapText: true };

  payload.sedes.forEach((sede, index) => {
    const cell = headerRow.getCell(index + 2);
    cell.value = `${sede.s.replace(/^\d+ /, "")}\n${sede.e.slice(0, 4)}`;
    cell.font = { bold: true, color: { argb: HEADER_FONT }, size: 8 };
    fillCell(cell, HEADER_FILL);
    borderCell(cell);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  headerRow.height = 32;

  writeMatrixBody(sheet, rows, 5);

  return workbook.xlsx.writeBuffer();
};

const writeMatrixBody = (
  sheet: ExcelJS.Worksheet,
  rows: MatrixExportRow[],
  startRow: number,
) => {
  rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(startRow + rowIndex);
    const labelCell = excelRow.getCell(1);
    labelCell.value = row.label;
    borderCell(labelCell);
    fillCell(labelCell, row.bold ? TOTAL_FILL : LABEL_FILL);
    labelCell.font = { bold: row.bold, size: row.depth >= 3 ? 9 : 10 };
    labelCell.alignment = { vertical: "middle", wrapText: true };

    row.cells.forEach((cell, colIndex) => {
      const excelCell = excelRow.getCell(colIndex + 2);
      excelCell.value = cell.text;
      borderCell(excelCell);
      fillCell(excelCell, heatmapExcelArgb(cell));
      excelCell.alignment = { horizontal: "center", vertical: "middle" };
      if (!cell.isValueMode && cell.pct !== null) {
        excelCell.font = { bold: true, size: 9 };
      } else {
        excelCell.font = { size: 9 };
      }
    });

    excelRow.height = row.depth >= 3 ? 16 : 18;
  });
};

export const downloadInformeMatrixExcel = async (
  options: InformeMatrixExcelOptions & { filename: string },
): Promise<void> => {
  const buffer = await writeInformeMatrixWorkbook(options);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = options.filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
