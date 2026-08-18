import { NextResponse } from "next/server";
import { applySessionCookies, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { queryOrdenesCompraBoard } from "@/lib/ordenes-compra/queries";
import type { OcVista } from "@/lib/ordenes-compra/status";
import { checkRateLimit } from "@/lib/shared/rate-limit";
import { canAccessOrdenesCompra } from "@/lib/shared/special-role-features";

const CACHE_CONTROL = "no-store";
const VISTAS: OcVista[] = [
  "todas",
  "abiertas",
  "incompletas",
  "vencidas",
  "cumplidas",
  "ayer",
];

const yyyymmdd = (raw: string | null): string | null => {
  if (!raw) return null;
  const compact = raw.trim().replace(/-/g, "");
  if (!/^\d{8}$/.test(compact)) return null;
  return compact;
};

function parseListParam(url: URL, keys: string[]): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    for (const raw of url.searchParams.getAll(key)) {
      for (const part of raw.split(",")) {
        const value = part.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        values.push(value);
      }
    }
  }
  return values;
}

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const withSession = (response: NextResponse) => {
    if (!response.headers.has("Cache-Control")) {
      response.headers.set("Cache-Control", CACHE_CONTROL);
    }
    return applySessionCookies(response, session);
  };

  if (
    !canAccessOrdenesCompra(
      session.user.role,
      session.user.allowedDashboards,
      session.user.allowedSubdashboards,
    )
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403 },
      ),
    );
  }

  const limitedUntil = checkRateLimit(request, {
    windowMs: 60_000,
    max: 40,
    keyPrefix: "ordenes-compra",
  });
  if (limitedUntil) {
    return withSession(
      NextResponse.json(
        { error: "Demasiadas consultas. Espera un momento." },
        { status: 429 },
      ),
    );
  }

  const url = new URL(request.url);
  const vistaRaw = (url.searchParams.get("vista") ?? "abiertas").trim();
  const vista = (VISTAS.includes(vistaRaw as OcVista) ? vistaRaw : "abiertas") as OcVista;
  const q = url.searchParams.get("q")?.trim() || null;
  const empresas = parseListParam(url, ["empresas", "empresa"]);
  const sedes = parseListParam(url, ["sedes", "sede"]);
  const proveedores = parseListParam(url, ["proveedores", "proveedor"]);
  const tipdoc = url.searchParams.get("tipdoc")?.trim() || null;
  const comprador = url.searchParams.get("comprador")?.trim() || null;
  const desde = yyyymmdd(url.searchParams.get("desde"));
  const hasta = yyyymmdd(url.searchParams.get("hasta"));
  if (url.searchParams.get("desde") && !desde) {
    return withSession(NextResponse.json({ error: "Fecha desde invalida." }, { status: 400 }));
  }
  if (url.searchParams.get("hasta") && !hasta) {
    return withSession(NextResponse.json({ error: "Fecha hasta invalida." }, { status: 400 }));
  }
  if (desde && hasta && hasta < desde) {
    return withSession(
      NextResponse.json({ error: "El rango de fechas es invalido." }, { status: 400 }),
    );
  }

  const pool = await getDbPool();
  const client = await pool.connect();
  try {
    const board = await queryOrdenesCompraBoard(client, {
      vista,
      q,
      empresas,
      sedes,
      proveedores,
      tipdoc,
      comprador,
      desde,
      hasta,
    });
    return withSession(NextResponse.json(board));
  } catch (error) {
    console.error("[ordenes-compra]", error);
    return withSession(
      NextResponse.json({ error: "No se pudieron leer las ordenes de compra." }, { status: 500 }),
    );
  } finally {
    client.release();
  }
}
