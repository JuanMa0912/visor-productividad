import { NextResponse } from "next/server";
import {
  applySessionCookies,
  requireAdminSession,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  isProveedoresVentasSede,
  listVentasProveedorRolling,
} from "@/lib/proveedores/ventas-repo";
import { checkRateLimit } from "@/lib/shared/rate-limit";

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
  const daysRaw = Number(url.searchParams.get("days") ?? 30);
  const days =
    Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 90 ? daysRaw : 30;
  const sede = url.searchParams.get("sede")?.trim() || null;
  const q = url.searchParams.get("q")?.trim() || null;

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
      limit: mode === "export" ? 2000 : 500,
    });

    if (mode === "export") {
      const header = [
        "proveedor",
        "codigo",
        "unidades",
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
