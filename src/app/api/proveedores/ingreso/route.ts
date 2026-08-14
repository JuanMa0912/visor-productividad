import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  closeSalida,
  countActiveProveedorCatalog,
  findOpenVisit,
  getProveedorById,
  insertEntrada,
  resolveSedeByToken,
  searchProveedorCatalog,
} from "@/lib/proveedores/repo";
import {
  isAcceptedDatosAutorizacion,
  isValidVisitanteCedula,
  isValidVisitanteNombre,
  normalizeVisitanteCedula,
  normalizeVisitanteNombre,
} from "@/lib/proveedores/types";
import { checkRateLimit } from "@/lib/shared/rate-limit";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status });

/** Meta de sede + búsqueda de catálogo (público, token requerido). */
export async function GET(request: Request) {
  const limitedUntil = checkRateLimit(request, {
    windowMs: 60_000,
    max: 60,
    keyPrefix: "proveedores-ingreso-get",
  });
  if (limitedUntil) {
    return json({ error: "Demasiadas solicitudes." }, 429);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const q = url.searchParams.get("q") ?? "";

  const client = await (await getDbPool()).connect();
  try {
    const sede = await resolveSedeByToken(client, token);
    if (!sede) {
      return json({ error: "Enlace de sede no válido." }, 404);
    }
    const providers = await searchProveedorCatalog(client, q, 30);
    // “Sin resultados” no es “catálogo vacío”: el visitante debe poder borrar
    // el texto y buscar otro proveedor sin que el campo quede deshabilitado.
    const activeCount = await countActiveProveedorCatalog(client);
    return json({
      sedeName: sede.sedeName,
      providers,
      catalogEmpty: activeCount === 0,
    });
  } catch (error) {
    console.error("[proveedores/ingreso GET]", error);
    return json({ error: "No se pudo cargar el ingreso." }, 500);
  } finally {
    client.release();
  }
}

type Body = {
  token?: string;
  action?: string;
  cedula?: string;
  nombre?: string;
  proveedorId?: string | number;
  visitId?: number;
  autorizacionDatos?: unknown;
};

/**
 * Público (sin sesión).
 * actions: lookup | entrada | salida
 */
export async function POST(request: Request) {
  const limitedUntil = checkRateLimit(request, {
    windowMs: 60_000,
    max: 40,
    keyPrefix: "proveedores-ingreso-post",
  });
  if (limitedUntil) {
    return json({ error: "Demasiadas solicitudes." }, 429);
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "Cuerpo inválido." }, 400);
  }

  const action = String(body.action ?? "").trim().toLowerCase();
  const cedula = normalizeVisitanteCedula(body.cedula);
  if (!isValidVisitanteCedula(cedula)) {
    return json({ error: "Cédula inválida (6–15 dígitos)." }, 400);
  }

  const client = await (await getDbPool()).connect();
  try {
    const sede = await resolveSedeByToken(client, body.token);
    if (!sede) {
      return json({ error: "Enlace de sede no válido." }, 404);
    }

    if (action === "lookup") {
      const open = await findOpenVisit(client, {
        sedeName: sede.sedeName,
        cedula,
      });
      return json({
        sedeName: sede.sedeName,
        status: open ? "open" : "none",
        visit: open,
      });
    }

    if (action === "entrada") {
      const open = await findOpenVisit(client, {
        sedeName: sede.sedeName,
        cedula,
      });
      if (open) {
        return json(
          {
            error:
              "Ya hay una visita abierta con esta cédula en esta sede. Registre la salida primero.",
            visit: open,
            status: "open",
          },
          409,
        );
      }
      if (!isAcceptedDatosAutorizacion(body.autorizacionDatos)) {
        return json(
          {
            error:
              "Debe autorizar el tratamiento de datos personales para registrar la entrada.",
          },
          400,
        );
      }
      const nombre = normalizeVisitanteNombre(body.nombre);
      if (!isValidVisitanteNombre(nombre)) {
        return json({ error: "Nombre inválido (mínimo 3 caracteres)." }, 400);
      }
      const proveedor = await getProveedorById(client, body.proveedorId);
      if (!proveedor) {
        return json(
          {
            error:
              "Seleccione un proveedor de la lista. Si no aparece ninguno, el catálogo aún no está cargado.",
          },
          400,
        );
      }
      const visit = await insertEntrada(client, {
        sedeName: sede.sedeName,
        proveedorCodigo: proveedor.codigo,
        proveedorEmpresa: proveedor.empresa,
        proveedorNombre: proveedor.nombre,
        visitanteNombre: nombre,
        visitanteCedula: cedula,
        clientIp: getClientIp(request),
        userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
        autorizacionDatosAt: new Date(),
      });
      return json({ status: "open", visit, message: "Entrada registrada." });
    }

    if (action === "salida") {
      const open =
        (await findOpenVisit(client, {
          sedeName: sede.sedeName,
          cedula,
        })) ?? null;
      if (!open) {
        return json(
          {
            error: "No hay visita abierta para esta cédula en esta sede.",
            status: "none",
          },
          404,
        );
      }
      const visitId = Number(body.visitId ?? open.id);
      if (visitId !== open.id) {
        return json({ error: "Visita no coincide." }, 400);
      }
      const closed = await closeSalida(client, {
        visitId: open.id,
        sedeName: sede.sedeName,
        cedula,
      });
      if (!closed) {
        return json({ error: "No se pudo registrar la salida." }, 409);
      }
      return json({
        status: "closed",
        visit: closed,
        message: "Salida registrada.",
      });
    }

    return json({ error: "Acción no reconocida." }, 400);
  } catch (error) {
    console.error("[proveedores/ingreso POST]", error);
    return json({ error: "No se pudo procesar el registro." }, 500);
  } finally {
    client.release();
  }
}
