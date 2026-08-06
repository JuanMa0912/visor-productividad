import { NextResponse } from "next/server";
import {
  applySessionCookies,
  requireAdminSession,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  queryPreciosProveedorMatrix,
  queryPreciosProveedorMeta,
} from "@/lib/exp-precios-proveedor/queries";
import { checkRateLimit } from "@/lib/shared/rate-limit";

const CACHE_CONTROL = "no-store";
const MAX_RANGE_DAYS = 14;

const isIsoDate = (value: string | null): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

const inclusiveDays = (start: string, end: string): number | null => {
  const a = Date.parse(`${start}T12:00:00`);
  const b = Date.parse(`${end}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return null;
  return Math.floor((b - a) / 86_400_000) + 1;
};

export async function GET(request: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado (solo admin)." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const withSession = (response: NextResponse) => {
    if (!response.headers.has("Cache-Control")) {
      response.headers.set("Cache-Control", CACHE_CONTROL);
    }
    return applySessionCookies(response, session);
  };

  const limitedUntil = checkRateLimit(request, {
    windowMs: 60_000,
    max: 40,
    keyPrefix: "exp-precios-proveedor",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas consultas. Espera un momento." },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSeconds) },
        },
      ),
    );
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "matrix" ? "matrix" : "meta";

  try {
    const pool = await getDbPool();
    const client = await pool.connect();
    try {
      if (mode === "meta") {
        const meta = await queryPreciosProveedorMeta(client);
        return withSession(NextResponse.json({ meta }));
      }

      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!isIsoDate(from) || !isIsoDate(to)) {
        return withSession(
          NextResponse.json(
            { error: "Fechas from/to inválidas (YYYY-MM-DD)." },
            { status: 400 },
          ),
        );
      }
      const days = inclusiveDays(from, to);
      if (days == null || days > MAX_RANGE_DAYS) {
        return withSession(
          NextResponse.json(
            {
              error: `Rango máximo ${MAX_RANGE_DAYS} días en el prototipo (pediste ${days ?? "?"}).`,
            },
            { status: 400 },
          ),
        );
      }

      const parseNum = (raw: string | null): number | null => {
        if (raw == null || raw.trim() === "") return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      };

      const sedesRaw = url.searchParams.get("sedes")?.trim() ?? "";
      const sedeKeys = sedesRaw
        ? sedesRaw
            .split(",")
            .map((key) => key.trim())
            .filter(Boolean)
        : null;

      const matrix = await queryPreciosProveedorMatrix(client, {
        fromIso: from,
        toIso: to,
        lineaId: url.searchParams.get("linea"),
        sublineaId: url.searchParams.get("sublinea"),
        sedeKeys,
        search: url.searchParams.get("search"),
        pvuMin: parseNum(url.searchParams.get("pvuMin")),
        pvuMax: parseNum(url.searchParams.get("pvuMax")),
        pcuMin: parseNum(url.searchParams.get("pcuMin")),
        pcuMax: parseNum(url.searchParams.get("pcuMax")),
        itemLimit: Number(url.searchParams.get("limit") ?? 40) || 40,
      });
      return withSession(NextResponse.json({ matrix }));
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[exp/precios-proveedor]", error);
    return withSession(
      NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Error consultando el prototipo.",
        },
        { status: 500 },
      ),
    );
  }
}
