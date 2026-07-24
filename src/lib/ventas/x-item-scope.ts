import { resolveMargenSedeScope } from "@/lib/margenes/margen-sede-scope";
import {
  canonicalizeEmpresaCode,
  DINASTIA_EMPRESA_CODE,
  resolveDataSourceKind,
  type EmpresaCode,
} from "@/lib/shared/data-tenant";

export type VentasXItemSessionScope = {
  role: "admin" | "user";
  sede: string | null;
  allowedSedes?: string[] | null;
  allowedEmpresas?: string[] | null;
};

export type VentasXItemResolvedScope =
  | {
      ok: true;
      /** null = sin filtro de empresa (alcance completo historico). */
      empresas: EmpresaCode[] | null;
      /**
       * Pares empresa|id_co permitidos. null = sin filtro de sede.
       * Si hay restriccion y queda vacio → no autorizado.
       */
      sedePairs: Array<{ empresa: string; idCo: string }> | null;
    }
  | { ok: false; error: string; status: 400 | 403 };

const parseSedeKey = (
  key: string,
): { empresa: string; idCo: string } | null => {
  const [empresaRaw, idCoRaw] = key.split("|");
  const empresa = canonicalizeEmpresaCode(empresaRaw);
  const idCo = (idCoRaw ?? "").trim().padStart(3, "0");
  if (!empresa || !/^\d{3}$/.test(idCo)) return null;
  if (empresa === DINASTIA_EMPRESA_CODE) return null;
  return { empresa, idCo };
};

/**
 * Alcance de empresa + sede para Ventas X ítem (tabla historica).
 * Dinastia no esta cableada aqui: se rechaza explicitamente.
 */
export const resolveVentasXItemScope = (
  sessionUser: VentasXItemSessionScope,
  requestedEmpresas: string[],
): VentasXItemResolvedScope => {
  const dataSource = resolveDataSourceKind(sessionUser, requestedEmpresas);
  if (!dataSource.ok) {
    return { ok: false, error: dataSource.error, status: 400 };
  }
  if (dataSource.kind === "dinastia") {
    return {
      ok: false,
      error:
        "Ventas por ítem aún no soporta Dinastía. Elige Mercamio, Comercializadora o Merkmios.",
      status: 400,
    };
  }

  const sedeScope = resolveMargenSedeScope(sessionUser);
  if (!sedeScope.authorized) {
    return {
      ok: false,
      error: "No tienes sedes asignadas para consultar ventas por ítem.",
      status: 403,
    };
  }

  let sedePairs: Array<{ empresa: string; idCo: string }> | null = null;
  if (sedeScope.allowedKeys !== null) {
    sedePairs = sedeScope.allowedKeys
      .map(parseSedeKey)
      .filter((pair): pair is { empresa: string; idCo: string } => pair !== null);
    if (sedePairs.length === 0) {
      return {
        ok: false,
        error: "No tienes sedes asignadas para consultar ventas por ítem.",
        status: 403,
      };
    }
  }

  // Si el usuario pidio empresas concretas, dataSource.empresas ya viene acotado.
  // Si pidio vacio y tiene allowedEmpresas, tambien viene la lista permitida.
  // null solo para admin / sin restriccion de empresa.
  let empresas = dataSource.empresas;
  if (empresas) {
    empresas = empresas.filter((code) => code !== DINASTIA_EMPRESA_CODE);
    if (empresas.length === 0) {
      return {
        ok: false,
        error: "No tienes empresas permitidas para esta consulta.",
        status: 403,
      };
    }
  }

  // Si hay pares de sede, acotar empresas al subconjunto de esos pares.
  if (sedePairs && empresas) {
    const sedeEmpresas = new Set(sedePairs.map((pair) => pair.empresa));
    empresas = empresas.filter((code) => sedeEmpresas.has(code));
    if (empresas.length === 0) {
      return {
        ok: false,
        error: "Las empresas solicitadas no coinciden con tus sedes permitidas.",
        status: 403,
      };
    }
    sedePairs = sedePairs.filter((pair) =>
      (empresas as EmpresaCode[]).includes(pair.empresa as EmpresaCode),
    );
  } else if (sedePairs && !empresas) {
    // Admin/todas empresas pero sedes restringidas: forzar empresas de los pares.
    const fromSedes = Array.from(
      new Set(sedePairs.map((pair) => pair.empresa)),
    ) as EmpresaCode[];
    empresas = fromSedes;
  }

  return { ok: true, empresas, sedePairs };
};

export const buildVentasSedePairWhereClause = (
  columnPrefix: string,
  params: unknown[],
  sedePairs: Array<{ empresa: string; idCo: string }> | null,
): string | null => {
  if (!sedePairs) return null;
  if (sedePairs.length === 0) return "FALSE";
  params.push(
    sedePairs.map((pair) => pair.empresa),
    sedePairs.map((pair) => pair.idCo),
  );
  const empresaParam = params.length - 1;
  const coParam = params.length;
  return `(COALESCE(NULLIF(${columnPrefix}empresa_norm, ''), ${columnPrefix}empresa), COALESCE(NULLIF(${columnPrefix}id_co_norm, ''), ${columnPrefix}id_co)) IN (
    SELECT * FROM UNNEST($${empresaParam}::text[], $${coParam}::text[]) AS t(empresa, id_co)
  )`;
};
