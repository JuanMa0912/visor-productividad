import { NextResponse } from "next/server";
import {
  applySessionCookies,
  requireAuthSession,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { queryLastProveedoresDataDate } from "@/lib/proveedores/board-filters";
import { listSedeQrTokens, listVisitas, computeVisitasMetrics, sanitizeQrVisitasJornada } from "@/lib/proveedores/repo";
import { canonicalizeProveedoresQrSede, PROVEEDORES_QR_SEDES } from "@/lib/proveedores/types";
import { getLocalPortalCloudUrl } from "@/lib/shared/local-portal-notices";
import { checkRateLimit } from "@/lib/shared/rate-limit";
import {
  canAccessProveedoresBoard,
  canViewProveedoresQrLinks,
} from "@/lib/shared/special-role-features";

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const csvEscape = (value: string) => {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

/** Base pública para QR: nunca localhost aunque el admin abra el tablero en local. */
const resolveProveedoresPublicOrigin = (requestUrl: URL): string => {
  const fromEnv = (
    process.env.PROVEEDORES_PUBLIC_BASE_URL ??
    process.env.PUBLIC_APP_URL ??
    ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (fromEnv) return fromEnv;

  const cloud = getLocalPortalCloudUrl().replace(/\/+$/, "");
  const host = requestUrl.hostname.toLowerCase();
  const isLocalHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local");
  if (isLocalHost) return cloud;
  return requestUrl.origin;
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const isAdmin = session.user.role === "admin";
  if (
    !canAccessProveedoresBoard(isAdmin, session.user.allowedSubdashboards)
  ) {
    return NextResponse.json({ error: "Sin permiso." }, { status: 403 });
  }
  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(request, {
    windowMs: 60_000,
    max: 60,
    keyPrefix: "proveedores-visitas",
  });
  if (limitedUntil) {
    return withSession(
      NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }),
    );
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "list";
  const dateStart = url.searchParams.get("dateStart")?.trim() ?? "";
  const dateEnd = url.searchParams.get("dateEnd")?.trim() ?? "";
  const sede = url.searchParams.get("sede")?.trim() || null;
  const q = url.searchParams.get("q")?.trim() || null;

  const client = await (await getDbPool()).connect();
  try {
    if (mode === "meta") {
      const canQr = canViewProveedoresQrLinks(
        session.user.specialRoles,
        isAdmin,
      );
      const origin = resolveProveedoresPublicOrigin(url);
      const qr = canQr ? await listSedeQrTokens(client) : [];
      const lastDataDate = await queryLastProveedoresDataDate(client);
      return withSession(
        NextResponse.json({
          sedes: [...PROVEEDORES_QR_SEDES],
          publicOrigin: origin,
          lastDataDate,
          qrLinks: qr.map((row) => ({
            sedeName: row.sedeName,
            activo: row.activo,
            path: `/proveedores/ingreso/${row.token}`,
            url: `${origin}/proveedores/ingreso/${row.token}`,
          })),
        }),
      );
    }

    if (!isIsoDate(dateStart) || !isIsoDate(dateEnd)) {
      return withSession(
        NextResponse.json(
          { error: "dateStart y dateEnd deben ser YYYY-MM-DD." },
          { status: 400 },
        ),
      );
    }
    if (dateStart > dateEnd) {
      return withSession(
        NextResponse.json(
          { error: "dateStart no puede ser mayor que dateEnd." },
          { status: 400 },
        ),
      );
    }
    const sedeCanon = canonicalizeProveedoresQrSede(sede);
    if (sede && !sedeCanon) {
      return withSession(
        NextResponse.json({ error: "Sede no válida." }, { status: 400 }),
      );
    }

    const filter = {
      dateStart,
      dateEnd,
      sedeName: sedeCanon,
      q,
    };
    const sanitized = await sanitizeQrVisitasJornada(client);
    if (sanitized.closed > 0 || sanitized.capped > 0) {
      console.info("[proveedores/visitas] cierre de jornada", sanitized);
    }
    const rows = await listVisitas(client, {
      ...filter,
      limit: mode === "export" ? 2000 : 500,
    });

    if (mode === "export") {
      const header = [
        "id",
        "sede",
        "proveedor",
        "visitante",
        "cedula",
        "entrada",
        "salida",
        "duracion_min",
      ];
      const lines = [
        header.join(","),
        ...rows.map((row) =>
          [
            String(row.id),
            csvEscape(row.sedeName),
            csvEscape(row.proveedorNombre),
            csvEscape(row.visitanteNombre),
            csvEscape(row.visitanteCedula),
            csvEscape(row.entradaAt),
            csvEscape(row.salidaAt ?? ""),
            row.duracionMinutos == null ? "" : String(row.duracionMinutos),
          ].join(","),
        ),
      ];
      const csv = `\uFEFF${lines.join("\n")}`;
      return withSession(
        new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="proveedores-visitas-${dateStart}_${dateEnd}.csv"`,
          },
        }),
      );
    }

    const metrics = await computeVisitasMetrics(client, filter);

    return withSession(
      NextResponse.json({
        dateStart,
        dateEnd,
        sede: sedeCanon,
        q,
        metrics,
        rows,
      }),
    );
  } catch (error) {
    console.error("[proveedores/visitas]", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudieron cargar las visitas." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
