import { NextResponse } from "next/server";
import { applySessionCookies, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { canAccessChecklistPanel } from "@/lib/checklists/access";
import { getChecklistPeriod } from "@/lib/checklists/period";
import {
  listPanelChecklistRuns,
  mapChecklistRun,
} from "@/lib/checklists/session-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const isAdmin = session.user.role === "admin";
  if (!canAccessChecklistPanel(session.user.specialRoles, isAdmin)) {
    const response = NextResponse.json(
      { error: "Sin acceso al panel de checklists." },
      { status: 403 },
    );
    return applySessionCookies(response, session);
  }

  const url = new URL(request.url);
  const current = getChecklistPeriod();
  const year = Number(url.searchParams.get("year") ?? current.year);
  const month = Number(url.searchParams.get("month") ?? current.month);
  const period = {
    year: Number.isInteger(year) ? year : current.year,
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : current.month,
  };

  const pool = await getDbPool();
  const client = await pool.connect();
  try {
    const rows = await listPanelChecklistRuns(client, period.year, period.month);
    const response = NextResponse.json({
      period,
      runs: rows.map((row) => mapChecklistRun(row)),
    });
    return applySessionCookies(response, session);
  } finally {
    client.release();
  }
}
