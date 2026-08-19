import { NextResponse } from "next/server";
import {
  applySessionCookies,
  requireAuthSession,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { parseProveedorLineaFilter } from "@/lib/proveedores/board-filters";
import {
  filterOipvRows,
  isOipvAsistenciaFilter,
  isProveedoresOipvSede,
  listOipvAsistenciaBoard,
} from "@/lib/proveedores/oipv-repo";
import { checkRateLimit } from "@/lib/shared/rate-limit";

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const csvEscape = (value: string) => {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Sin permiso." }, { status: 403 });
  }
  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(request, {
    windowMs: 60_000,
    max: 40,
    keyPrefix: "proveedores-oipv",
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
  const linea = parseProveedorLineaFilter(url.searchParams.get("linea"));
  const filterRaw = url.searchParams.get("filter")?.trim() || "all";
  if (!isOipvAsistenciaFilter(filterRaw)) {
    return withSession(
      NextResponse.json({ error: "Filtro de asistencia no válido." }, { status: 400 }),
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
  if (sede && !isProveedoresOipvSede(sede)) {
    return withSession(
      NextResponse.json({ error: "Sede no válida." }, { status: 400 }),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const data = await listOipvAsistenciaBoard(client, {
      dateStart,
      dateEnd,
      sede,
      q,
      linea,
      limit: mode === "export" ? 5000 : 2000,
    });

    if (mode === "export") {
      const exportRows = filterOipvRows(data.rows, filterRaw);
      const header = [
        "rs_proveedor",
        "codigo",
        "visitante",
        "asistencia",
        "L",
        "Ma",
        "Mi",
        "J",
        "V",
        "S",
        "D",
        "visitas",
        "unidades",
        "hl",
        "venta_neta",
        "costo_mercancia",
      ];
      const lines = [
        header.join(","),
        ...exportRows.map((row) =>
          [
            csvEscape(row.rsProveedor),
            csvEscape(row.codigo ?? ""),
            csvEscape(row.visitante ?? ""),
            row.asistencia ? "X" : "",
            row.weekdays.L ? "X" : "",
            row.weekdays.Ma ? "X" : "",
            row.weekdays.Mi ? "X" : "",
            row.weekdays.J ? "X" : "",
            row.weekdays.V ? "X" : "",
            row.weekdays.S ? "X" : "",
            row.weekdays.D ? "X" : "",
            String(row.visitas),
            String(row.unidades),
            String(row.hl),
            String(row.ventaNeta),
            String(row.costoMercancia ?? 0),
          ].join(","),
        ),
      ];
      const csv = `\uFEFF${lines.join("\n")}`;
      return withSession(
        new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="proveedores-oipv-${dateStart}_${dateEnd}.csv"`,
          },
        }),
      );
    }

    return withSession(NextResponse.json(data));
  } catch (error) {
    console.error("[proveedores/oipv]", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo cargar OIPV / asistencia." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
