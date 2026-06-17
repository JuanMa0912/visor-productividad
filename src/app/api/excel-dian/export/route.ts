import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { applySessionCookies, requireAuthSession } from "@/lib/auth";
import {
  getExcelDianPool,
  type ExcelDianDbEmpresa,
} from "@/lib/excel-dian/excel-dian-db";
import {
  MTODO_MEDIOS_MAGNETICOS_COLUMNS,
  buildYearLapsoRange,
  queryMtodoMediosMagneticos,
} from "@/lib/excel-dian/mtodo-medios-magneticos";
import { checkRateLimit } from "@/lib/shared/rate-limit";
import { isExcelDianExportPublic } from "@/lib/excel-dian/public-export-env";
import {
  EXCEL_DIAN_EMPRESA_OPTIONS,
  isExcelDianEmpresaEnabled,
} from "@/app/ExcelDian/excel-dian-empresa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const NUMERIC_VALUE_KEYS = new Set([
  "Ingresos Brutos Recibidos",
  "Devoluciones Rebajas Descuentos",
]);

const COLUMN_WIDTH_BY_KEY: Partial<Record<string, number>> = {
  Concepto: 10,
  "Tipo Documento": 13,
  "Numero Identificacion": 18,
  DV: 6,
  "Primer Apellido": 16,
  "Segundo Apellido": 16,
  "Primer Nombre": 16,
  "Otros Nombres": 16,
  "Razon Social": 36,
  Direccion: 30,
  "Codigo Pais": 11,
  "Codigo Departamento": 14,
  "Codigo Municipio": 14,
  "Ingresos Brutos Recibidos": 22,
  "Devoluciones Rebajas Descuentos": 26,
};

/** Bordes finos tipo plantilla Office (similar a F1007 contabilidad). */
const BORDER_GRID = {
  style: "thin" as const,
  color: { argb: "FFB4B4B4" },
};

/**
 * Paleta alineada al borrador F1007 (hoja F1007 del libro de contabilidad):
 * encabezado teal, texto blanco Calibri 10 negrita, filas alternas claras.
 */
const HEADER_FILL = "FF48878A";
const HEADER_FONT = "FFFFFFFF";
const ZEBRA_BAND_FILL = "FFE8EFF8";
const DATA_FONT_SIZE = 10;
const HEADER_FONT_SIZE = 10;
/** Millares estilo contabilidad (equiv. numFmt 165 del libro de referencia). */
const NUM_FMT_ACCOUNTING_INT =
  '_-* #,##0_-;\\-* #,##0_-;\\-* "-"??_-;\\-_@_-';

const MAX_SPAN_MONTHS = 36;

const EXCEL_DIAN_ENV_PREFIX: Record<ExcelDianDbEmpresa, string> = {
  mtodo: "EXCEL_DIAN_MTDO",
  mio: "EXCEL_DIAN_MIO",
  bgt: "EXCEL_DIAN_BGT",
};

const parseExcelDianEmpresaParam = (
  raw: string | null,
): ExcelDianDbEmpresa | null => {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "mtodo" || v === "mio" || v === "bgt") return v;
  if (v === "mercamio") return "mio";
  if (v === "bogota") return "bgt";
  return null;
};

const excelDianEmpresaLabel = (code: ExcelDianDbEmpresa): string =>
  EXCEL_DIAN_EMPRESA_OPTIONS.find((o) => o.value === code)?.label ?? code;

const parseLapsoParam = (value: string | null): string | null => {
  const s = value?.trim();
  if (!s || !/^\d{6}$/.test(s)) return null;
  const y = Number.parseInt(s.slice(0, 4), 10);
  const m = Number.parseInt(s.slice(4, 6), 10);
  if (!Number.isInteger(y) || y < MIN_YEAR || y > MAX_YEAR) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  return s;
};

const currentLapsoYm = (): string => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const monthsInclusiveSpan = (start: string, end: string): number => {
  const ys = Number.parseInt(start.slice(0, 4), 10);
  const ms = Number.parseInt(start.slice(4, 6), 10);
  const ye = Number.parseInt(end.slice(0, 4), 10);
  const me = Number.parseInt(end.slice(4, 6), 10);
  return (ye - ys) * 12 + (me - ms) + 1;
};

const parseMonth1to12 = (value: string | null): number | null => {
  const n = Number(value?.trim());
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
};

const parseYear = (value: string | null) => {
  const year = Number(value?.trim());
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return null;
  }
  return year;
};

const toWholeNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
};

const normalizeExcelRow = (
  row: Awaited<ReturnType<typeof queryMtodoMediosMagneticos>>["rows"][number],
) =>
  Object.fromEntries(
    MTODO_MEDIOS_MAGNETICOS_COLUMNS.map((column) => {
      const value = row[column.key];
      return [
        column.key,
        NUMERIC_VALUE_KEYS.has(column.key)
          ? toWholeNumber(value)
          : (value ?? ""),
      ];
    }),
  );

const buildWorkbook = async (
  rows: Awaited<ReturnType<typeof queryMtodoMediosMagneticos>>["rows"],
  startLapso: string,
  endLapso: string,
  metaEmpresa: { label: string; dbCode: ExcelDianDbEmpresa },
) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Visor de Productividad";
  workbook.created = new Date();
  workbook.properties.date1904 = false;

  const sheet = workbook.addWorksheet("F1007", {
    views: [
      {
        state: "frozen",
        ySplit: 1,
        activeCell: "A2",
        showGridLines: true,
        zoomScale: 90,
        zoomScaleNormal: 90,
      },
    ],
    properties: {
      defaultRowHeight: 15,
      defaultColWidth: 10,
    },
  });

  sheet.columns = MTODO_MEDIOS_MAGNETICOS_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width:
      COLUMN_WIDTH_BY_KEY[column.key] ??
      Math.min(28, Math.max(12, column.header.length + 3)),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  headerRow.font = {
    bold: true,
    color: { argb: HEADER_FONT },
    name: "Calibri",
    size: HEADER_FONT_SIZE,
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL },
  };
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber <= MTODO_MEDIOS_MAGNETICOS_COLUMNS.length) {
      cell.border = {
        top: BORDER_GRID,
        left: BORDER_GRID,
        bottom: BORDER_GRID,
        right: BORDER_GRID,
      };
    }
  });

  rows.forEach((row) => {
    sheet.addRow(normalizeExcelRow(row));
  });

  const colCount = MTODO_MEDIOS_MAGNETICOS_COLUMNS.length;
  MTODO_MEDIOS_MAGNETICOS_COLUMNS.forEach((column, index) => {
    const col = sheet.getColumn(index + 1);
    if (NUMERIC_VALUE_KEYS.has(column.key)) {
      col.alignment = { horizontal: "right", vertical: "middle" };
    } else {
      col.alignment = { horizontal: "left", vertical: "middle", wrapText: false };
    }
  });

  const lastRow = sheet.rowCount;
  for (let r = 2; r <= lastRow; r += 1) {
    const row = sheet.getRow(r);
    row.alignment = { vertical: "middle" };
    const zebraFill =
      r % 2 === 0
        ? {
            type: "pattern" as const,
            pattern: "solid" as const,
            fgColor: { argb: ZEBRA_BAND_FILL },
          }
        : {
            type: "pattern" as const,
            pattern: "solid" as const,
            fgColor: { argb: "FFFFFFFF" },
          };
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (colNumber > colCount) return;
      cell.border = {
        top: BORDER_GRID,
        left: BORDER_GRID,
        bottom: BORDER_GRID,
        right: BORDER_GRID,
      };
      cell.fill = zebraFill;
      cell.font = { name: "Calibri", size: DATA_FONT_SIZE };
      const key = MTODO_MEDIOS_MAGNETICOS_COLUMNS[colNumber - 1]?.key;
      if (key && NUMERIC_VALUE_KEYS.has(key)) {
        cell.numFmt = NUM_FMT_ACCOUNTING_INT;
      }
    });
  }

  /* Fila 1: alineacion por columna y formato contable no deben afectar titulos (evita "-" en encabezados). */
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > colCount) return;
    cell.font = {
      bold: true,
      color: { argb: HEADER_FONT },
      name: "Calibri",
      size: HEADER_FONT_SIZE,
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.numFmt = "@";
  });

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: colCount },
  };

  const meta = workbook.addWorksheet("Parametros", {
    views: [{ zoomScale: 90, zoomScaleNormal: 90 }],
    properties: { defaultRowHeight: 15, defaultColWidth: 10 },
  });
  meta.columns = [
    { header: "Campo", key: "field", width: 28 },
    { header: "Valor", key: "value", width: 42 },
  ];
  meta.addRows([
    { field: "Empresa", value: metaEmpresa.label },
    { field: "Base de datos", value: metaEmpresa.dbCode },
    { field: "Lapso inicial", value: startLapso },
    { field: "Lapso final", value: endLapso },
    { field: "Registros exportados", value: rows.length },
    {
      field: "Generado",
      value: new Date().toLocaleString("es-CO", { hour12: false }),
    },
  ]);

  const metaHeader = meta.getRow(1);
  metaHeader.height = 22;
  metaHeader.font = {
    bold: true,
    color: { argb: HEADER_FONT },
    name: "Calibri",
    size: HEADER_FONT_SIZE,
  };
  metaHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL },
  };
  metaHeader.alignment = { vertical: "middle", horizontal: "center" };
  metaHeader.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber <= 2) {
      cell.border = {
        top: BORDER_GRID,
        left: BORDER_GRID,
        bottom: BORDER_GRID,
        right: BORDER_GRID,
      };
    }
  });

  for (let r = 2; r <= meta.rowCount; r += 1) {
    const metaBand =
      r % 2 === 0
        ? {
            type: "pattern" as const,
            pattern: "solid" as const,
            fgColor: { argb: ZEBRA_BAND_FILL },
          }
        : {
            type: "pattern" as const,
            pattern: "solid" as const,
            fgColor: { argb: "FFFFFFFF" },
          };
    meta.getRow(r).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      cell.font = { name: "Calibri", size: DATA_FONT_SIZE };
      cell.border = {
        top: BORDER_GRID,
        left: BORDER_GRID,
        bottom: BORDER_GRID,
        right: BORDER_GRID,
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: "left",
        wrapText: colNumber === 2,
      };
      cell.fill = metaBand;
    });
    meta.getRow(r).getCell(1).font = {
      name: "Calibri",
      size: DATA_FONT_SIZE,
      bold: true,
      color: { argb: "FF44546A" },
    };
  }

  return workbook;
};

export async function GET(request: Request) {
  const exportPublic = isExcelDianExportPublic();
  const session = exportPublic ? null : await requireAuthSession();
  if (!exportPublic && !session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const finalizeResponse = async (response: NextResponse) => {
    if (session) {
      return applySessionCookies(response, session);
    }
    return response;
  };

  const limitedUntil = checkRateLimit(request, {
    windowMs: 5 * 60_000,
    max: 12,
    keyPrefix: "excel-dian-export",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return finalizeResponse(
      NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta mas tarde." },
        {
          status: 429,
          headers: {
            "Retry-After": retryAfterSeconds.toString(),
            "Cache-Control": "no-store",
          },
        },
      ),
    );
  }

  const url = new URL(request.url);
  const empresa = parseExcelDianEmpresaParam(url.searchParams.get("empresa"));
  if (!empresa) {
    return finalizeResponse(
      NextResponse.json(
        {
          error:
            "Indica empresa=mtodo, mio o bgt (Comercializadora, Mercamio o Merkmios).",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    );
  }

  // Merkmios (bgt) aun no tiene consulta estandar; no corremos la query de
  // mtodo/mio contra su base. El selector ya lo deshabilita, pero la API tambien
  // valida (puede llamarse directo, incluso con export publico).
  if (!isExcelDianEmpresaEnabled(empresa)) {
    return finalizeResponse(
      NextResponse.json(
        {
          error:
            "La exportacion para Merkmios (Bogota) esta en construccion: aun no hay consulta estandar.",
        },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      ),
    );
  }

  const lapsoStartQ = parseLapsoParam(url.searchParams.get("startLapso"));
  const lapsoEndQ = parseLapsoParam(url.searchParams.get("endLapso"));

  let startLapso: string;
  let endLapso: string;

  if (lapsoStartQ && lapsoEndQ) {
    if (lapsoStartQ > lapsoEndQ) {
      return finalizeResponse(
        NextResponse.json(
          { error: "El lapso inicial no puede ser mayor que el lapso final." },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        ),
      );
    }
    if (monthsInclusiveSpan(lapsoStartQ, lapsoEndQ) > MAX_SPAN_MONTHS) {
      return finalizeResponse(
        NextResponse.json(
          { error: `El rango no puede superar ${MAX_SPAN_MONTHS} meses.` },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        ),
      );
    }
    startLapso = lapsoStartQ;
    endLapso = lapsoEndQ;
  } else if (lapsoStartQ || lapsoEndQ) {
    return finalizeResponse(
      NextResponse.json(
        {
          error:
            "Envía startLapso y endLapso juntos (formato YYYYMM), o usa year (y opcionalmente month).",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    );
  } else {
    const year = parseYear(url.searchParams.get("year"));
    if (!year) {
      return finalizeResponse(
        NextResponse.json(
          { error: "Indica un año válido (year) o lapso (startLapso y endLapso)." },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        ),
      );
    }
    const month = parseMonth1to12(url.searchParams.get("month"));
    if (month != null) {
      startLapso = `${year}${String(month).padStart(2, "0")}`;
      endLapso = startLapso;
    } else {
      const y = buildYearLapsoRange(year);
      startLapso = y.startLapso;
      endLapso = y.endLapso;
    }
  }

  const capLapso = currentLapsoYm();
  if (startLapso > capLapso) {
    return finalizeResponse(
      NextResponse.json(
        { error: "El periodo no puede ser completamente futuro." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    );
  }
  if (endLapso > capLapso) {
    endLapso = capLapso;
  }
  if (startLapso > endLapso) {
    return finalizeResponse(
      NextResponse.json(
        { error: "El periodo queda vacío tras ajustar al mes en curso." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    );
  }

  try {
    let pool;
    try {
      pool = await getExcelDianPool(empresa);
    } catch (envErr) {
      const msg =
        envErr instanceof Error
          ? envErr.message
          : "Configuracion de base de datos incompleta.";
      return finalizeResponse(
        NextResponse.json(
          {
            error: `${msg} Revisa las variables ${EXCEL_DIAN_ENV_PREFIX[empresa]}_DB_* en el entorno.`,
          },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        ),
      );
    }
    const client = await pool.connect();
    try {
      const { rows, startLapso: sl, endLapso: el } =
        await queryMtodoMediosMagneticos(client, startLapso, endLapso);
      const workbook = await buildWorkbook(rows, sl, el, {
        label: excelDianEmpresaLabel(empresa),
        dbCode: empresa,
      });
      const raw = await workbook.xlsx.writeBuffer();
      const body = Buffer.isBuffer(raw) ? raw : Buffer.from(new Uint8Array(raw as ArrayBuffer));
      const filename = `medios-magneticos-${empresa}-${sl}-${el}.xlsx`;
      const byteLength = body.length;

      return finalizeResponse(
        new NextResponse(body, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Length": String(byteLength),
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        }),
      );
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(
      "[excel-dian] Error generando exportacion:",
      error instanceof Error ? error.message : error,
    );
    return finalizeResponse(
      NextResponse.json(
        { error: "No se pudo generar el Excel DIAN." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      ),
    );
  }
}
