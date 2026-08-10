import { NextResponse } from "next/server";
import {
  applySessionCookies,
  requireAuthSession,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { isProveedoresProductividadSede } from "@/lib/proveedores/line-family";
import { listProductividadProveedores } from "@/lib/proveedores/productividad-repo";
import { checkRateLimit } from "@/lib/shared/rate-limit";
import { canAccessProveedoresBoard } from "@/lib/shared/special-role-features";

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const MAX_RANGE_DAYS = 31;

const csvEscape = (value: string) => {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

const inclusiveDays = (start: string, end: string): number | null => {
  const startMs = Date.parse(`${start}T12:00:00`);
  const endMs = Date.parse(`${end}T12:00:00`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    return null;
  }
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
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
    max: 30,
    keyPrefix: "proveedores-productividad",
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

  if (!isIsoDate(dateStart) || !isIsoDate(dateEnd)) {
    return withSession(
      NextResponse.json({ error: "Rango de fechas inválido." }, { status: 400 }),
    );
  }
  const days = inclusiveDays(dateStart, dateEnd);
  if (days == null || days > MAX_RANGE_DAYS) {
    return withSession(
      NextResponse.json(
        { error: `El rango máximo es ${MAX_RANGE_DAYS} días.` },
        { status: 400 },
      ),
    );
  }
  if (sede && !isProveedoresProductividadSede(sede)) {
    return withSession(
      NextResponse.json({ error: "Sede no válida." }, { status: 400 }),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const data = await listProductividadProveedores(client, {
      dateStart,
      dateEnd,
      sede,
      q,
      proveedorLimit: mode === "export" ? 2000 : 300,
    });

    if (mode === "export") {
      const sedeHeader = [
        "sede",
        "industria_und",
        "fruver_kg",
        "carnes_kg",
        "cajas_tx",
      ];
      const sedeLines = [
        sedeHeader.join(","),
        ...data.bySede.map((row) =>
          [
            csvEscape(row.sede),
            String(row.industria),
            String(row.fruver),
            String(row.carnes),
            String(row.cajas),
          ].join(","),
        ),
      ];
      const provHeader = [
        "proveedor",
        "codigo",
        "industria_und",
        "fruver_kg",
        "carnes_kg",
        "sedes_activas",
      ];
      const provLines = [
        "",
        provHeader.join(","),
        ...data.proveedores.map((row) =>
          [
            csvEscape(row.proveedor),
            csvEscape(row.codigo ?? ""),
            String(row.industria),
            String(row.fruver),
            String(row.carnes),
            String(row.sedesActivas),
          ].join(","),
        ),
      ];
      const csv = `\uFEFF${sedeLines.join("\n")}${provLines.join("\n")}`;
      return withSession(
        new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="proveedores-productividad-${dateStart}_${dateEnd}.csv"`,
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
        ...data,
      }),
    );
  } catch (error) {
    console.error("[proveedores/productividad]", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo cargar la productividad por familia." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
