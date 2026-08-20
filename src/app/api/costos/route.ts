import { NextResponse } from "next/server";
import {
  applySessionCookies,
  requireAuthSession,
} from "@/lib/auth";
import { canAccessPreciosProveedor } from "@/lib/shared/special-role-features";
import { getDbPool } from "@/lib/db";
import {
  queryPreciosProveedorItemExpand,
  queryPreciosProveedorItemOptions,
  queryPreciosProveedorMatrix,
  queryPreciosProveedorMeta,
  queryPreciosProveedorPrev,
} from "@/lib/exp-precios-proveedor/queries";
import { splitCostosCsv } from "@/lib/exp-precios-proveedor/filters";
import { checkRateLimit } from "@/lib/shared/rate-limit";

const CACHE_CONTROL = "no-store";
// Un mes completo. Medido contra la base del tablero: el CTE pesado pasa de
// 1.119 ms con 14 dias a 2.416 ms con 31, y las filas apenas crecen de 61.250 a
// 66.030 porque se agrupan por item y sede: lo que crece es el barrido, no el
// resultado.
const MAX_RANGE_DAYS = 31;

const isIsoDate = (value: string | null): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

const inclusiveDays = (start: string, end: string): number | null => {
  const a = Date.parse(`${start}T12:00:00`);
  const b = Date.parse(`${end}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return null;
  return Math.floor((b - a) / 86_400_000) + 1;
};

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
    !canAccessPreciosProveedor(
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
    max: 80,
    keyPrefix: "costos",
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
  const modeRaw = url.searchParams.get("mode");
  const mode =
    modeRaw === "matrix" ||
    modeRaw === "proveedores" ||
    modeRaw === "items" ||
    modeRaw === "prev"
      ? modeRaw
      : "meta";

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

      const sedeKeys = splitCostosCsv(url.searchParams.get("sedes"));
      const lineaIds = splitCostosCsv(url.searchParams.get("linea"));
      const sublineaIds = splitCostosCsv(url.searchParams.get("sublinea"));
      const proveedorIds = splitCostosCsv(url.searchParams.get("proveedor"));
      const marcaIds = splitCostosCsv(url.searchParams.get("marca"));
      const itemIds = splitCostosCsv(url.searchParams.get("items"));

      if (mode === "prev") {
        // Totales del periodo anterior para los deltas de cabecera. Se pide en
        // paralelo desde el cliente, acotado a los items que ya trajo la matriz.
        const prev = await queryPreciosProveedorPrev(client, {
          fromIso: from,
          toIso: to,
          itemIds: splitCostosCsv(url.searchParams.get("items")),
          sedeKeys: sedeKeys.length > 0 ? sedeKeys : null,
        });
        return withSession(NextResponse.json({ prev }));
      }

      if (mode === "items") {
        const items = await queryPreciosProveedorItemOptions(client, {
          q: url.searchParams.get("q"),
          lineaIds,
          sublineaIds,
          fromIso: from,
          toIso: to,
        });
        return withSession(NextResponse.json({ items }));
      }

      if (mode === "proveedores") {
        const item = url.searchParams.get("item")?.trim() ?? "";
        if (!item) {
          return withSession(
            NextResponse.json(
              { error: "Falta el ítem para desplegar proveedores." },
              { status: 400 },
            ),
          );
        }
        const expand = await queryPreciosProveedorItemExpand(client, {
          itemId: item,
          label: url.searchParams.get("label"),
          fromIso: from,
          toIso: to,
          sedeKeys: sedeKeys.length > 0 ? sedeKeys : null,
        });
        return withSession(NextResponse.json({ expand }));
      }

      const matrix = await queryPreciosProveedorMatrix(client, {
        fromIso: from,
        toIso: to,
        lineaIds,
        sublineaIds,
        proveedorIds,
        marcaIds,
        itemIds,
        sedeKeys: sedeKeys.length > 0 ? sedeKeys : null,
        search: url.searchParams.get("search"),
        itemLimit: Number(url.searchParams.get("limit") ?? 40) || 40,
      });
      return withSession(NextResponse.json({ matrix }));
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[costos]", error);
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
