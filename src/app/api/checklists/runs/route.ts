import { NextResponse } from "next/server";
import { applySessionCookies, requireAuthSession, verifyCsrf } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  canFillChecklistAsEncargado,
  canFillChecklistAsRevisor,
  canUnlockChecklistRuns,
  parseChecklistActorRole,
} from "@/lib/checklists/access";
import { getChecklistPeriod } from "@/lib/checklists/period";
import {
  completeChecklistRun,
  deleteChecklistRun,
  expireIfNeeded,
  findLatestEncargadoRun,
  findMonthlyRun,
  getChecklistEvidence,
  listChecklistEvidenceKeys,
  listExpiredChecklistRuns,
  loadLatestRun,
  mapChecklistRun,
  reopenChecklistRun,
  saveChecklistSnapshot,
  startChecklistRun,
  upsertChecklistEvidence,
} from "@/lib/checklists/session-store";
import { isChecklistSessionId } from "@/lib/checklists/session";
import { parseChecklistSnapshot } from "@/lib/checklists/snapshot";
import {
  CHECKLIST_MIGRATION_HINT,
  isChecklistSchemaError,
  missingChecklistPhotoKeys,
  parseChecklistEvidencePhoto,
  parseChecklistSignature,
} from "@/lib/checklists/evidence";
import { canAccessPortalSubsection } from "@/lib/shared/portal-sections";
import { checkRateLimit } from "@/lib/shared/rate-limit";

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "private, no-store";

type Session = NonNullable<Awaited<ReturnType<typeof requireAuthSession>>>;

const canUseChecklists = (session: Session) => {
  const isAdmin = session.user.role === "admin";
  return (
    isAdmin ||
    canAccessPortalSubsection(session.user.allowedSubdashboards, "checklists") ||
    canUnlockChecklistRuns(session.user.specialRoles, isAdmin)
  );
};

const withSession = (session: Session, data: unknown, status = 200) => {
  const response = NextResponse.json(data, {
    status,
    headers: { "Cache-Control": CACHE_CONTROL },
  });
  return applySessionCookies(response, session);
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (!canUseChecklists(session)) {
    return withSession(session, { error: "Sin acceso a checklists." }, 403);
  }

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope")?.trim() ?? "";
  const checklistId = url.searchParams.get("checklistId")?.trim() ?? "";
  const isAdmin = session.user.role === "admin";
  const specialRoles = session.user.specialRoles;

  const pool = await getDbPool();
  const client = await pool.connect();
  try {
    if (scope === "expired") {
      if (!canUnlockChecklistRuns(specialRoles, isAdmin)) {
        return withSession(session, { error: "Sin permiso para ver vencidos." }, 403);
      }
      const rows = await listExpiredChecklistRuns(client);
      return withSession(session, {
        runs: rows.map((row) => mapChecklistRun(row)),
      });
    }

    if (!isChecklistSessionId(checklistId)) {
      return withSession(session, { error: "Checklist invalido." }, 400);
    }
    const latest = await expireIfNeeded(
      client,
      await loadLatestRun(client, session.user.id, checklistId),
    );
    const sede = latest?.sede;
    const period = getChecklistPeriod();
    const prior =
      latest?.actor_role === "revisor" && sede
        ? await findLatestEncargadoRun(
            client,
            checklistId,
            sede,
            period.year,
            period.month,
          )
        : latest?.actor_role === "encargado" && sede
          ? await findLatestEncargadoRun(
              client,
              checklistId,
              sede,
              period.year,
              period.month,
            ).then((row) => (row && row.id !== latest.id ? row : null))
          : null;
    const evidenceKeys = latest
      ? await listChecklistEvidenceKeys(client, latest.id).catch((error) => {
          if (isChecklistSchemaError(error)) return [] as string[];
          throw error;
        })
      : [];
    const evidenceItem = url.searchParams.get("evidenceItem")?.trim() ?? "";
    if (latest && evidenceItem) {
      const photo = await getChecklistEvidence(
        client,
        latest.id,
        session.user.id,
        evidenceItem,
      );
      return withSession(session, {
        run: mapChecklistRun(latest),
        evidenceKeys,
        evidence: photo,
      });
    }
    return withSession(session, {
      run: latest
        ? { ...mapChecklistRun(latest), evidenceKeys }
        : null,
      priorRun:
        prior && prior.status === "completed" ? mapChecklistRun(prior) : null,
      canFillEncargado: canFillChecklistAsEncargado(specialRoles, isAdmin),
      canFillRevisor: canFillChecklistAsRevisor(specialRoles, isAdmin),
      evidenceKeys,
    });
  } catch (error) {
    console.error("[checklists/runs GET]", error);
    return withSession(
      session,
      {
        error: isChecklistSchemaError(error)
          ? `Faltan tablas o columnas de checklists. ${CHECKLIST_MIGRATION_HINT}`
          : error instanceof Error
            ? error.message
            : "No se pudo leer el intento.",
      },
      500,
    );
  } finally {
    client.release();
  }
}

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (!(await verifyCsrf(request))) {
    return withSession(session, { error: "CSRF invalido." }, 403);
  }
  if (!canUseChecklists(session)) {
    return withSession(session, { error: "Sin acceso a checklists." }, 403);
  }

  const limitedUntil = checkRateLimit(request, {
    windowMs: 60_000,
    max: 60,
    keyPrefix: "checklist-runs",
  });
  if (limitedUntil) {
    return withSession(session, { error: "Demasiadas solicitudes." }, 429);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return withSession(session, { error: "JSON invalido." }, 400);
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  const checklistId =
    typeof body.checklistId === "string" ? body.checklistId.trim() : "";
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  const isAdmin = session.user.role === "admin";
  const specialRoles = session.user.specialRoles;

  const pool = await getDbPool();
  const client = await pool.connect();
  try {
    if (action === "reopen") {
      if (!canUnlockChecklistRuns(specialRoles, isAdmin)) {
        return withSession(session, { error: "Sin permiso para desbloquear." }, 403);
      }
      if (!runId) {
        return withSession(session, { error: "Falta el intento a habilitar." }, 400);
      }
      const reopened = await reopenChecklistRun(client, runId, session.user.id);
      if (!reopened) {
        return withSession(
          session,
          { error: "No se pudo habilitar. El intento no esta vencido." },
          409,
        );
      }
      return withSession(session, { run: mapChecklistRun(reopened) });
    }

    if (action === "delete") {
      if (!canUnlockChecklistRuns(specialRoles, isAdmin)) {
        return withSession(session, { error: "Sin permiso para borrar." }, 403);
      }
      if (!runId) {
        return withSession(session, { error: "Falta el intento a borrar." }, 400);
      }
      const deleted = await deleteChecklistRun(client, runId);
      if (!deleted) {
        return withSession(session, { error: "No se encontró el intento." }, 404);
      }
      return withSession(session, { deleted: true, runId });
    }

    if (!isChecklistSessionId(checklistId)) {
      return withSession(session, { error: "Checklist invalido." }, 400);
    }

    if (action === "save") {
      if (!runId) {
        return withSession(session, { error: "Falta el intento." }, 400);
      }
      const snapshot = parseChecklistSnapshot(body.snapshot);
      const saved = await saveChecklistSnapshot(
        client,
        runId,
        session.user.id,
        snapshot,
      );
      if (!saved) {
        return withSession(session, { error: "No se pudo guardar el avance." }, 409);
      }
      return withSession(session, { run: mapChecklistRun(saved) });
    }

    if (action === "start") {
      const actorRole = parseChecklistActorRole(body.actorRole);
      const empresa = typeof body.empresa === "string" ? body.empresa.trim() : "";
      const sede = typeof body.sede === "string" ? body.sede.trim() : "";
      if (!actorRole || !empresa || !sede) {
        return withSession(
          session,
          { error: "Indica rol, empresa y sede para comenzar." },
          400,
        );
      }
      if (
        actorRole === "encargado" &&
        !canFillChecklistAsEncargado(specialRoles, isAdmin)
      ) {
        return withSession(session, { error: "No tienes rol de encargado." }, 403);
      }
      if (
        actorRole === "revisor" &&
        !canFillChecklistAsRevisor(specialRoles, isAdmin)
      ) {
        return withSession(session, { error: "No tienes rol de revisor." }, 403);
      }

      const latest = await expireIfNeeded(
        client,
        await loadLatestRun(client, session.user.id, checklistId),
      );
      if (latest?.status === "in_progress") {
        const period = getChecklistPeriod();
        const prior = await findLatestEncargadoRun(
          client,
          checklistId,
          latest.sede || sede,
          period.year,
          period.month,
        );
        return withSession(session, {
          run: mapChecklistRun(latest),
          priorRun:
            prior && prior.id !== latest.id ? mapChecklistRun(prior) : null,
        });
      }

      const period = getChecklistPeriod();
      const monthly = await findMonthlyRun(
        client,
        checklistId,
        sede,
        actorRole,
        period.year,
        period.month,
      );
      const monthlyLive = await expireIfNeeded(client, monthly);
      if (monthlyLive?.status === "completed") {
        return withSession(
          session,
          {
            error:
              "Este checklist ya se diligenció este mes en esa sede para ese rol.",
            run: mapChecklistRun(monthlyLive),
            monthlyDone: true,
          },
          409,
        );
      }
      if (monthlyLive?.status === "expired") {
        return withSession(
          session,
          {
            error:
              "El intento del mes se venció. Quien tenga el panel de checklists debe desbloquearlo.",
            run: mapChecklistRun(monthlyLive),
            needsUnlock: true,
          },
          409,
        );
      }
      if (monthlyLive?.status === "in_progress") {
        if (monthlyLive.user_id !== session.user.id) {
          return withSession(
            session,
            { error: "Ya hay un intento en curso este mes en esa sede." },
            409,
          );
        }
        const prior = await findLatestEncargadoRun(
          client,
          checklistId,
          sede,
          period.year,
          period.month,
        );
        return withSession(session, {
          run: mapChecklistRun(monthlyLive),
          priorRun:
            prior && prior.id !== monthlyLive.id
              ? mapChecklistRun(prior)
              : null,
        });
      }

      const started = await startChecklistRun(client, {
        userId: session.user.id,
        checklistId,
        actorRole,
        empresa,
        sede,
      });
      const prior =
        actorRole === "revisor"
          ? await findLatestEncargadoRun(
              client,
              checklistId,
              sede,
              period.year,
              period.month,
            )
          : null;
      return withSession(session, {
        run: mapChecklistRun(started),
        priorRun: prior ? mapChecklistRun(prior) : null,
      });
    }

    if (action === "photo") {
      if (!runId) {
        return withSession(session, { error: "Falta el intento." }, 400);
      }
      const itemKey =
        typeof body.itemKey === "string" ? body.itemKey.trim() : "";
      if (!itemKey) {
        return withSession(session, { error: "Falta el ítem de la foto." }, 400);
      }
      const parsed = parseChecklistEvidencePhoto(body.fotoBase64, body.mime);
      if (!parsed.ok) {
        return withSession(session, { error: parsed.error }, 400);
      }
      const saved = await upsertChecklistEvidence(client, {
        runId,
        userId: session.user.id,
        itemKey,
        fotoBase64: parsed.base64,
        mime: parsed.mime,
      });
      if (!saved) {
        return withSession(
          session,
          { error: "No se pudo guardar la foto. El intento no está en curso." },
          409,
        );
      }
      const evidenceKeys = await listChecklistEvidenceKeys(client, runId);
      return withSession(session, { ok: true, evidenceKeys });
    }

    if (action === "complete") {
      if (!runId) {
        return withSession(session, { error: "Falta el intento a finalizar." }, 400);
      }
      const latest = await expireIfNeeded(
        client,
        await loadLatestRun(client, session.user.id, checklistId),
      );
      if (!latest || latest.id !== runId) {
        return withSession(session, { error: "Intento no encontrado." }, 404);
      }
      if (latest.status === "expired") {
        return withSession(
          session,
          {
            error: "El tiempo se agoto. El checklist quedo cerrado.",
            run: mapChecklistRun(latest),
            needsUnlock: true,
          },
          409,
        );
      }
      const snapshot = body.snapshot
        ? parseChecklistSnapshot(body.snapshot)
        : parseChecklistSnapshot(latest.answers);
      const signature = parseChecklistSignature(body.signaturePng);
      if (!signature.ok) {
        return withSession(session, { error: signature.error }, 400);
      }
      const evidenceKeys = await listChecklistEvidenceKeys(client, runId);
      const missingPhotos = missingChecklistPhotoKeys(
        snapshot.answers,
        evidenceKeys,
      );
      if (missingPhotos.length > 0) {
        return withSession(
          session,
          {
            error: `Hay ${missingPhotos.length} hallazgo(s) P/NC sin foto. Sube la foto antes de finalizar.`,
            missingPhotos,
          },
          400,
        );
      }
      const completed = await completeChecklistRun(
        client,
        runId,
        session.user.id,
        snapshot,
        signature.value,
      );
      if (!completed) {
        return withSession(session, { error: "No se pudo finalizar el checklist." }, 409);
      }
      return withSession(session, {
        run: { ...mapChecklistRun(completed), evidenceKeys },
      });
    }

    return withSession(session, { error: "Accion invalida." }, 400);
  } catch (error) {
    console.error("[checklists/runs POST]", error);
    return withSession(
      session,
      {
        error: isChecklistSchemaError(error)
          ? `Faltan tablas o columnas de checklists. ${CHECKLIST_MIGRATION_HINT}`
          : error instanceof Error
            ? error.message
            : "No se pudo actualizar el intento.",
      },
      500,
    );
  } finally {
    client.release();
  }
}
