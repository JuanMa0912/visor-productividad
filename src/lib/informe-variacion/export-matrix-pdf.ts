import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  buildMatrixExportRows,
  heatmapPdfRgb,
  matrixExportMetaLine,
  type BuildMatrixExportOptions,
} from "@/lib/informe-variacion/export-matrix";

export type InformeMatrixPdfOptions = BuildMatrixExportOptions & {
  periodLabel: string;
};

export const buildInformeMatrixPdfDocument = ({
  payload,
  periodLabel,
  metric,
  matrixMode,
  matrixDisplay,
  ...rest
}: InformeMatrixPdfOptions): jsPDF => {
  const rows = buildMatrixExportRows({
    payload,
    metric,
    matrixMode,
    matrixDisplay,
    ...rest,
  });

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text("Matriz comparativa entre sedes", 10, 12);

  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(matrixExportMetaLine(periodLabel, metric, matrixMode, matrixDisplay), 10, 18);
  doc.text(`Generado: ${new Date().toLocaleString("es-CO")}`, 10, 23);

  const head = [
    [
      "Categoria / Linea / Sublinea / Item",
      ...payload.sedes.map(
        (sede) => `${sede.s.replace(/^\d+ /, "")}\n${sede.e.slice(0, 4)}`,
      ),
    ],
  ];

  const body = rows.map((row) => [row.label, ...row.cells.map((cell) => cell.text)]);

  autoTable(doc, {
    startY: 27,
    head,
    body,
    theme: "grid",
    styles: {
      fontSize: 6,
      cellPadding: 1.2,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: [255, 255, 255],
      fontSize: 6,
      halign: "center",
    },
    columnStyles: {
      0: { cellWidth: 52, halign: "left" },
    },
    margin: { left: 8, right: 8, bottom: 10 },
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index === 0) {
        if (data.section === "body" && data.column.index === 0) {
          const row = rows[data.row.index];
          if (row?.bold) {
            data.cell.styles.fillColor = [226, 232, 240];
            data.cell.styles.fontStyle = "bold";
          }
        }
        return;
      }

      const row = rows[data.row.index];
      const cell = row?.cells[data.column.index - 1];
      if (!cell) return;

      const colors = heatmapPdfRgb(cell);
      data.cell.styles.fillColor = colors.fill;
      data.cell.styles.textColor = colors.text;
      if (!cell.isValueMode && cell.pct !== null) {
        data.cell.styles.fontStyle = "bold";
      }
      data.cell.styles.halign = "center";
    },
  });

  return doc;
};

export const downloadInformeMatrixPdf = (options: InformeMatrixPdfOptions & { filename: string }): void => {
  const doc = buildInformeMatrixPdfDocument(options);
  doc.save(options.filename);
};
