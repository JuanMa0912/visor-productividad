import * as ExcelJS from "exceljs";
import type {
  SedeSummaryExportRow,
  SedeSummaryExportRowKind,
} from "@/lib/informe-variacion/export-sede-summary";
import type { InformeMetric } from "@/lib/informe-variacion/types";

const EMPRESA_FILL: Record<string, string> = {
  Comercializadora: "FFDBEAFE",
  Mercamio: "FFFEF3C7",
  Merkmios: "FFEDE9FE",
};

const EMPRESA_ACCENT: Record<string, string> = {
  Comercializadora: "FF2563EB",
  Mercamio: "FFD97706",
  Merkmios: "FF7C3AED",
};

const HEADER_FILL = "FF1E3A5F";
const HEADER_FONT = "FFFFFFFF";
const TOTAL_FILL = "FFE2E8F0";
const SEDE_ALT_FILL = "FFF8FAFC";
const BORDER_COLOR = "FFCBD5E1";
const POSITIVE_FONT = "FF0E6B3D";
const NEGATIVE_FONT = "FFA01F2D";
const NEUTRAL_FONT = "FF64748B";

const MILES_FMT = '#,##0';
const UNITS_FMT = '#,##0.0';
const PCT_FMT = '0.0"%";[Red]0.0"%";"—"';
const PART_FMT = '0.0"%"';

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

const pctFontColor = (value: number | null | undefined): string | undefined => {
  if (value === null || value === undefined) return NEUTRAL_FONT;
  if (value > 0.05) return POSITIVE_FONT;
  if (value < -0.05) return NEGATIVE_FONT;
  return undefined;
};

const writePctCell = (
  cell: ExcelJS.Cell,
  label: string,
  value: number | null,
) => {
  if (value === null || label === "N/D" || label === "—") {
    cell.value = label;
    cell.font = { color: { argb: NEUTRAL_FONT }, italic: label === "N/D" };
    cell.alignment = { horizontal: "right" };
    return;
  }
  if (label === "Nuevo") {
    cell.value = label;
    cell.font = { color: { argb: POSITIVE_FONT }, bold: true };
    cell.alignment = { horizontal: "right" };
    return;
  }
  cell.value = value;
  cell.numFmt = PCT_FMT;
  const color = pctFontColor(value);
  if (color) cell.font = { color: { argb: color }, bold: true };
  cell.alignment = { horizontal: "right" };
};

export type InformeSedeSummaryExcelOptions = {
  rows: SedeSummaryExportRow[];
  metric: InformeMetric;
  periodLabel: string;
  yoyLabel: string;
  momLabel: string;
};

export const writeInformeSedeSummaryWorkbook = async ({
  rows,
  metric,
  periodLabel,
  yoyLabel,
  momLabel,
}: InformeSedeSummaryExcelOptions): Promise<ArrayBuffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Visor Productividad";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Resumen sedes", {
    views: [{ state: "frozen", ySplit: 4 }],
  });

  const valueHeader = metric === "u" ? "Actual (unidades)" : "Actual ($ miles)";
  const valueFmt = metric === "u" ? UNITS_FMT : MILES_FMT;

const MARG_FMT = '0.0"%";"—"';

  sheet.columns = [
    { key: "empresa", width: 24 },
    { key: "sede", width: 30 },
    { key: "current", width: 16 },
    { key: "currentMargPct", width: 10 },
    { key: "yoyBase", width: 16 },
    { key: "yoyMargPct", width: 10 },
    { key: "yoyPct", width: 12 },
    { key: "momBase", width: 16 },
    { key: "momMargPct", width: 10 },
    { key: "momPct", width: 12 },
    { key: "participationPct", width: 14 },
  ];

  sheet.mergeCells("A1:K1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = "Informe de variacion MoM · YoY";
  titleCell.font = { bold: true, size: 14, color: { argb: HEADER_FONT } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
  titleCell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 28;

  sheet.mergeCells("A2:K2");
  const subtitleCell = sheet.getCell("A2");
  subtitleCell.value = `Periodo: ${periodLabel}  ·  Metrica: ${metric === "u" ? "Unidades" : "Valor ($ miles)"}`;
  subtitleCell.font = { size: 10, color: { argb: "FF1E293B" } };
  subtitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
  subtitleCell.alignment = { vertical: "middle" };
  sheet.getRow(2).height = 20;

  sheet.mergeCells("A3:K3");
  const metaCell = sheet.getCell("A3");
  metaCell.value = `Generado: ${new Date().toLocaleString("es-CO")}`;
  metaCell.font = { size: 9, italic: true, color: { argb: NEUTRAL_FONT } };
  metaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  sheet.getRow(3).height = 18;

  const headerRow = sheet.getRow(4);
  [
    "Empresa",
    "Sede",
    valueHeader,
    "Marg %",
    `${yoyLabel} base`,
    "Marg %",
    "YoY %",
    `${momLabel} base`,
    "Marg %",
    "MoM %",
    "Participacion %",
  ].forEach((label, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: HEADER_FONT }, size: 10 };
    fillCell(cell, HEADER_FILL);
    borderCell(cell);
    cell.alignment = {
      horizontal: index >= 2 ? "right" : "left",
      vertical: "middle",
      wrapText: true,
    };
  });
  headerRow.height = 22;

  let sedeStripe = 0;

  rows.forEach((row) => {
    const excelRow = sheet.addRow({
      empresa: row.kind === "sede" ? "" : row.empresa,
      sede: row.kind === "sede" ? `    ${row.sede}` : row.sede,
      current: row.current,
      currentMargPct: row.currentMargPct ?? "",
      yoyBase: row.yoyBase ?? "",
      yoyMargPct: row.yoyMargPct ?? "",
      momBase: row.momBase,
      momMargPct: row.momMargPct ?? "",
      participationPct: row.participationPct ?? "",
    });

    const kind: SedeSummaryExportRowKind = row.kind;
    const empresaFill = EMPRESA_FILL[row.empresa] ?? "FFE2E8F0";
    const accent = EMPRESA_ACCENT[row.empresa] ?? "FF475569";

    excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      borderCell(cell);
      cell.alignment = {
        vertical: "middle",
        horizontal: colNumber >= 3 ? "right" : "left",
        indent: colNumber === 2 && kind === "sede" ? 1 : 0,
      };

      if (kind === "empresa") {
        fillCell(cell, empresaFill);
        cell.font = { bold: true, color: { argb: accent } };
      } else if (kind === "sede") {
        const alt = sedeStripe % 2 === 1;
        fillCell(cell, alt ? SEDE_ALT_FILL : "FFFFFFFF");
        if (colNumber === 2) {
          cell.font = { color: { argb: "FF334155" } };
        }
      } else {
        fillCell(cell, TOTAL_FILL);
        cell.font = { bold: true, color: { argb: "FF0F172A" } };
      }
    });

    if (kind === "sede") sedeStripe += 1;
    if (kind === "empresa") sedeStripe = 0;

    excelRow.getCell(3).numFmt = valueFmt;
    if (row.yoyBase !== null) excelRow.getCell(5).numFmt = valueFmt;
    excelRow.getCell(8).numFmt = valueFmt;

    const writeMargCell = (cell: ExcelJS.Cell, value: number | null) => {
      if (value === null) {
        cell.value = "—";
        cell.font = { color: { argb: NEUTRAL_FONT } };
        cell.alignment = { horizontal: "right" };
        return;
      }
      cell.value = value;
      cell.numFmt = MARG_FMT;
      cell.alignment = { horizontal: "right" };
    };

    writeMargCell(excelRow.getCell(4), row.currentMargPct);
    writeMargCell(excelRow.getCell(6), row.yoyMargPct);
    writeMargCell(excelRow.getCell(9), row.momMargPct);

    writePctCell(excelRow.getCell(7), row.yoyPct, row.yoyPctValue);
    writePctCell(excelRow.getCell(10), row.momPct, row.momPctValue);

    const partCell = excelRow.getCell(11);
    if (row.participationPct === null) {
      partCell.value = "";
    } else {
      partCell.value = row.participationPct;
      partCell.numFmt = PART_FMT;
      partCell.font = { color: { argb: NEUTRAL_FONT } };
    }

    if (kind === "empresa" || kind === "total") {
      excelRow.height = 22;
    } else {
      excelRow.height = 19;
    }
  });

  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4 + rows.length, column: 11 },
  };

  return workbook.xlsx.writeBuffer();
};

export const downloadInformeSedeSummaryExcel = async (
  options: InformeSedeSummaryExcelOptions & { filename: string },
): Promise<void> => {
  const buffer = await writeInformeSedeSummaryWorkbook(options);
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
