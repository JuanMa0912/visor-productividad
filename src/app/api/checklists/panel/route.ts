import { NextResponse } from "next/server";
import { applySessionCookies, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { canAccessChecklistPanel } from "@/lib/checklists/access";
import {
  CHECKLIST_MIGRATION_HINT,
  isChecklistSchemaError,
} from "@/lib/checklists/evidence";
import { getChecklistPeriod } from "@/lib/checklists/period";
import {
  listChecklistEvidenceForRun,
  listPanelChecklistRuns,
  loadChecklistRunById,
  mapChecklistRun,
} from "@/lib/checklists/session-store";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const runId = url.searchParams.get("runId")?.trim() ?? "";
  const current = getChecklistPeriod();
  const year = Number(url.searchParams.get("year") ?? current.year);
  const month = Number(url.searchParams.get("month") ?? current.month);
  const period = {
    year: Number.isInteger(year) ? year : current.year,
    month:
      Number.isInteger(month) && month >= 1 && month <= 12
        ? month
        : current.month,
  };

  const pool = await getDbPool();
  const client = await pool.connect();
  try {
    if (runId) {
      if (!UUID_RE.test(runId)) {
        const response = NextResponse.json(
          { error: "Intento inválido." },
          { status: 400 },
        );
        return applySessionCookies(response, session);
      }
      const row = await loadChecklistRunById(client, runId);
      if (!row) {
        const response = NextResponse.json(
          { error: "No se encontró el intento." },
          { status: 404 },
        );
        return applySessionCookies(response, session);
      }
      const evidence = await listChecklistEvidenceForRun(client, runId).catch(
        (error) => {
          if (isChecklistSchemaError(error)) return [];
          throw error;
        },
      );
      const response = NextResponse.json({
        run: mapChecklistRun(row),
        evidence,
        signaturePng: row.signature_png ?? null,
      });
      return applySessionCookies(response, session);
    }

    const rows = await listPanelChecklistRuns(client, period.year, period.month);
    const response = NextResponse.json({
      period,
      runs: rows.map((row) => mapChecklistRun(row)),
    });
    return applySessionCookies(response, session);
  } catch (error) {
    console.error("[checklists/panel]", error);
    const message = isChecklistSchemaError(error)
      ? `Faltan tablas o columnas de checklists. ${CHECKLIST_MIGRATION_HINT}`
      : error instanceof Error
        ? error.message
        : "No se pudo cargar el panel de checklists.";
    const response = NextResponse.json({ error: message }, { status: 500 });
    return applySessionCookies(response, session);
  } finally {
    client.release();
  }
}
