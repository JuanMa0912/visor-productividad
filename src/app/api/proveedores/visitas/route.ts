import { NextResponse } from "next/server";
import {
  applySessionCookies,
  requireAdminSession,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { listSedeQrTokens, listVisitas } from "@/lib/proveedores/repo";
import { PROVEEDORES_QR_SEDES } from "@/lib/proveedores/types";
import { checkRateLimit } from "@/lib/shared/rate-limit";

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const csvEscape = (value: string) => {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

export async function GET(request: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
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
      const qr = await listSedeQrTokens(client);
      const origin = url.origin;
      return withSession(
        NextResponse.json({
          sedes: [...PROVEEDORES_QR_SEDES],
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
    if (sede && !(PROVEEDORES_QR_SEDES as readonly string[]).includes(sede)) {
      return withSession(
        NextResponse.json({ error: "Sede no válida." }, { status: 400 }),
      );
    }

    const rows = await listVisitas(client, {
      dateStart,
      dateEnd,
      sedeName: sede,
      q,
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

    return withSession(
      NextResponse.json({
        dateStart,
        dateEnd,
        sede,
        q,
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
