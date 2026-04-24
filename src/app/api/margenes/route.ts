import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/portal-sections";

type MarginDbRow = {
  fecha: string;
  empresa: string;
  centro_operacion: string;
  id_linea1: string;
  nombre_linea1: string | null;
  venta_sin_iva: string | number | null;
  iva: string | number | null;
  venta_con_iva: string | number | null;
  costo_total: string | number | null;
  utilidad_bruta: string | number | null;
};

const ALLOWED_MARGIN_LINES = new Set([
  "cajas",
  "fruver",
  "industria",
  "carnes",
  "pollo y pescado",
  "asadero",
]);

const normalizeLineId = (value: string) => value.trim().toLowerCase();

const resolveSessionAllowedLineIds = (allowedLines: string[] | null | undefined) => {
  if (!Array.isArray(allowedLines) || allowedLines.length === 0) {
    return [] as string[];
  }
  return Array.from(
    new Set(
      allowedLines
        .map((line) => (typeof line === "string" ? normalizeLineId(line) : ""))
        .filter((line) => ALLOWED_MARGIN_LINES.has(line)),
    ),
  );
};

type MarginRow = {
  date: string;
  empresa: string;
  sede: string;
  lineaId: string;
  lineaName: string;
  ventaSinIva: number;
  iva: number;
  ventaConIva: number;
  costoTotal: number;
  utilidadBruta: number;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const HIDDEN_SEDES = new Set(["adm", "cedicavasa", "cedi-cavasa"]);

const SEDE_NAMES: Record<string, string> = {
  "001|mercamio": "Calle 5ta",
  "002|mercamio": "La 39",
  "003|mercamio": "Plaza Norte",
  "004|mercamio": "Ciudad Jardín",
  "005|mercamio": "Centro Sur",
  "006|mercamio": "Palmira",
  "001|mtodo": "Floresta",
  "002|mtodo": "Floralia",
  "003|mtodo": "Guaduales",
  "001|bogota": "Bogotá",
  "002|bogota": "Chía",
};

const getClientIp = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
};

const checkRateLimit = (request: Request) => {
  const now = Date.now();
  const clientIp = getClientIp(request);
  const entry = rateLimitStore.get(clientIp);
  if (!entry || entry.resetAt <= now) {
    rateLimitStore.set(clientIp, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return null;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return entry.resetAt;
  }
  entry.count += 1;
  return null;
};

const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const EMPRESA_ALIASES: Record<string, string> = {
  mercamio: "mercamio",
  mcamio: "mercamio",
  mercatodo: "mtodo",
  mtodo: "mtodo",
  merkmios: "bogota",
  bogota: "bogota",
};

const normalizeEmpresa = (value: string) => {
  const normalized = value.toLowerCase().replace(/\s+/g, "").trim();
  return EMPRESA_ALIASES[normalized] ?? normalized;
};

const toNumber = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const resolveSedeName = (centroOperacion: string, empresa: string) => {
  const cleanCenter = centroOperacion.trim().padStart(3, "0");
  const cleanEmpresa = normalizeEmpresa(empresa);
  const mapped = SEDE_NAMES[`${cleanCenter}|${cleanEmpresa}`];
  if (mapped) return mapped;
  const empresaLabel = empresa.trim() || "empresa";
  return `${empresaLabel} ${cleanCenter}`;
};

const queryMargins = async (allowedLineIds: string[] = []): Promise<MarginRow[]> => {
  const pool = await getDbPool();
  const client = await pool.connect();
  const allowedSet = new Set(allowedLineIds.map(normalizeLineId));

  try {
    const result = await client.query(
      `
      SELECT
        TO_CHAR(
          CASE
            WHEN fecha_dcto::text ~ '^[0-9]{8}$' THEN TO_DATE(fecha_dcto::text, 'YYYYMMDD')
            ELSE fecha_dcto::date
          END,
          'YYYY-MM-DD'
        ) AS fecha,
        COALESCE(TRIM(empresa), '') AS empresa,
        LPAD(TRIM(COALESCE(centro_operacion::text, '')), 3, '0') AS centro_operacion,
        COALESCE(TRIM(id_linea1::text), '') AS id_linea1,
        NULLIF(TRIM(COALESCE(nombre_linea1, '')), '') AS nombre_linea1,
        COALESCE(SUM(venta_sin_iva), 0) AS venta_sin_iva,
        COALESCE(SUM(iva), 0) AS iva,
        COALESCE(SUM(venta_con_iva), 0) AS venta_con_iva,
        COALESCE(SUM(costo_total), 0) AS costo_total,
        COALESCE(SUM(utilidad_bruta), 0) AS utilidad_bruta
      FROM margenes_linea_co_dia
      WHERE fecha_dcto IS NOT NULL
        AND centro_operacion IS NOT NULL
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY 1, 2, 3, 4
      `,
    );

    const rows = (result.rows ?? []) as MarginDbRow[];
    return rows
      .map((row) => {
        const sede = resolveSedeName(row.centro_operacion, row.empresa);
        const normalizedLineId = normalizeLineId(row.id_linea1 || "sin_linea");
        return {
          date: row.fecha,
          empresa: row.empresa.trim() || "sin_empresa",
          sede,
          lineaId: normalizedLineId,
          lineaName: row.nombre_linea1 || row.id_linea1 || "Sin linea",
          ventaSinIva: toNumber(row.venta_sin_iva),
          iva: toNumber(row.iva),
          ventaConIva: toNumber(row.venta_con_iva),
          costoTotal: toNumber(row.costo_total),
          utilidadBruta: toNumber(row.utilidad_bruta),
        };
      })
      .filter((row) =>
        allowedSet.size === 0 ? true : allowedSet.has(normalizeLineId(row.lineaId)),
      )
      .filter((row) => !HIDDEN_SEDES.has(normalizeKey(row.sede)));
  } finally {
    client.release();
  }
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const withSession = (response: NextResponse) => {
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    return response;
  };

  const limitedUntil = checkRateLimit(request);
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

  try {
  const allowedLineIds =
    session.user.role === "admin"
      ? []
      : resolveSessionAllowedLineIds(session.user.allowedLines);
  const allowedDashboards = session.user.allowedDashboards;
  if (
    session.user.role !== "admin" &&
    (!canAccessPortalSection(allowedDashboards, "producto") ||
      !canAccessPortalSubsection(session.user.allowedSubdashboards, "margenes"))
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403 },
      ),
    );
  }
    const rows = await queryMargins(allowedLineIds);
    const sedes = Array.from(new Set(rows.map((row) => row.sede))).map(
      (name) => ({
        id: name,
        name,
      }),
    );
    const lineas = Array.from(
      new Map(
        rows.map((row) => [
          row.lineaId,
          { id: row.lineaId, name: row.lineaName || row.lineaId },
        ]),
      ).values(),
    );

    return withSession(
      NextResponse.json(
        { rows, sedes, lineas },
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Data-Source": "database",
          },
        },
      ),
    );
  } catch (error) {
    console.error("Error en endpoint de margenes:", error);
    return withSession(
      NextResponse.json(
        {
          rows: [],
          sedes: [],
          lineas: [],
          error:
            "Error de conexion: " +
            (error instanceof Error ? error.message : String(error)),
        },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        },
      ),
    );
  }
}
