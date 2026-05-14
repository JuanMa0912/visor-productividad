import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { applySessionCookies, requireAuthSession } from "@/lib/auth";
import { getMtodoExcelDianPool } from "@/lib/excel-dian/mtodo-db";
import {
  MTODO_MEDIOS_MAGNETICOS_COLUMNS,
  queryMtodoMediosMagneticos,
} from "@/lib/excel-dian/mtodo-medios-magneticos";
import { checkRateLimit } from "@/lib/shared/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const NUMERIC_VALUE_KEYS = new Set([
  "valor_bruto",
  "suma_descuentos",
  "suma_impo1",
  "suma_impo2",
  "imp_bolsa",
  "ingresos_brutos_propios",
  "devoluciones_notas",
  "total_ingreso",
]);

const parseYear = (value: string | null) => {
  const year = Number(value);
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
  year: number,
  startLapso: string,
  endLapso: string,
) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Visor de Productividad";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Comercializadora", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = MTODO_MEDIOS_MAGNETICOS_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: Math.max(column.header.length + 2, 16),
  }));

  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };

  rows.forEach((row) => {
    sheet.addRow(normalizeExcelRow(row));
  });

  MTODO_MEDIOS_MAGNETICOS_COLUMNS.forEach((column, index) => {
    if (NUMERIC_VALUE_KEYS.has(column.key)) {
      sheet.getColumn(index + 1).numFmt = "0";
    }
  });

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: MTODO_MEDIOS_MAGNETICOS_COLUMNS.length },
  };

  const meta = workbook.addWorksheet("Parametros");
  meta.columns = [
    { header: "Campo", key: "field", width: 24 },
    { header: "Valor", key: "value", width: 24 },
  ];
  meta.addRows([
    { field: "Empresa", value: "Comercializadora" },
    { field: "Base", value: "mtodo" },
    { field: "Anio", value: year },
    { field: "Lapso inicial", value: startLapso },
    { field: "Lapso final", value: endLapso },
    { field: "Filas", value: rows.length },
  ]);
  meta.getRow(1).font = { bold: true };

  return workbook;
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(request, {
    windowMs: 5 * 60_000,
    max: 12,
    keyPrefix: "excel-dian-export",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
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
  const empresa = (url.searchParams.get("empresa") ?? "").trim().toLowerCase();
  if (empresa !== "mtodo") {
    return withSession(
      NextResponse.json(
        { error: "Por ahora la exportacion DIAN solo esta habilitada para Comercializadora." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    );
  }

  const year = parseYear(url.searchParams.get("year"));
  if (!year) {
    return withSession(
      NextResponse.json(
        { error: "Debes enviar un anio valido." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    );
  }

  try {
    const pool = await getMtodoExcelDianPool();
    const client = await pool.connect();
    try {
      const { rows, startLapso, endLapso } =
        await queryMtodoMediosMagneticos(client, year);
      const workbook = await buildWorkbook(rows, year, startLapso, endLapso);
      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `medios-magneticos-comercializadora-${year}.xlsx`;

      return withSession(
        new NextResponse(buffer, {
          headers: {
            "Cache-Control": "no-store",
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
    return withSession(
      NextResponse.json(
        { error: "No se pudo generar el Excel DIAN." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      ),
    );
  }
}
