import { NextResponse } from "next/server";
import {
  applySessionCookies,
  requireAuthSession,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { parseProveedorLineaFilter } from "@/lib/proveedores/board-filters";
import {
  isProveedoresVentasSede,
  listVentasProveedorRolling,
} from "@/lib/proveedores/ventas-repo";
import {
  inasistenciaHorasFromUnidades,
  inasistenciaPersonasFromUnidades,
} from "@/lib/proveedores/inasistencia";
import { checkRateLimit } from "@/lib/shared/rate-limit";
import { canAccessProveedoresBoard } from "@/lib/shared/special-role-features";

const csvEscape = (value: string) => {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
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
    max: 40,
    keyPrefix: "proveedores-ventas",
  });
  if (limitedUntil) {
    return withSession(
      NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }),
    );
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "list";
  const daysRaw = Number(url.searchParams.get("days") ?? 1);
  const days =
    Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 90 ? daysRaw : 1;
  const sede = url.searchParams.get("sede")?.trim() || null;
  const q = url.searchParams.get("q")?.trim() || null;
  const linea = parseProveedorLineaFilter(url.searchParams.get("linea"));

  if (sede && !isProveedoresVentasSede(sede)) {
    return withSession(
      NextResponse.json({ error: "Sede no válida." }, { status: 400 }),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const data = await listVentasProveedorRolling(client, {
      days,
      sede,
      q,
      linea,
      limit: mode === "export" ? 2000 : 500,
    });

    if (mode === "export") {
      const header = [
        "proveedor",
        "codigo",
        "unidades",
        "horas_surtido",
        "inasistencia_personas",
        "venta_neta",
        "venta_con_impuesto",
        "items",
        "sedes_activas",
      ];
      const lines = [
        header.join(","),
        ...data.rows.map((row) =>
          [
            csvEscape(row.proveedor),
            csvEscape(row.codigo ?? ""),
            String(row.unidades),
            String(inasistenciaHorasFromUnidades(row.unidades)),
            String(inasistenciaPersonasFromUnidades(row.unidades)),
            String(row.ventaNeta),
            String(row.ventaConImpuesto),
            String(row.items),
            String(row.sedesActivas),
          ].join(","),
        ),
      ];
      const csv = `\uFEFF${lines.join("\n")}`;
      return withSession(
        new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="proveedores-ventas-${data.metrics.fechaInicio}_${data.metrics.fechaFin}.csv"`,
          },
        }),
      );
    }

    return withSession(
      NextResponse.json({
        days,
        sede,
        q,
        ...data,
      }),
    );
  } catch (error) {
    console.error("[proveedores/ventas]", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudieron cargar las ventas por proveedor." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
