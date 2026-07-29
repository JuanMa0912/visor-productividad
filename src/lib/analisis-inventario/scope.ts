import {
  filterMargenSedeCatalogForUser,
  resolveMargenSedeScope,
  type MargenSessionSedeScope,
} from "@/lib/margenes/margen-sede-scope";
import {
  DINASTIA_EMPRESA_CODE,
  resolveDataSourceKind,
  userIsDinastiaOnly,
} from "@/lib/shared/data-tenant";
import {
  ROTACION_SOURCE_DINASTIA,
  ROTACION_SOURCE_LEGACY,
  resolveRotacionCleanMatview,
  type RotacionSourceTable,
} from "@/lib/rotacion/source-tables";
import type { AnalisisInventarioSedeColumn } from "@/lib/analisis-inventario/types";

export type AnalisisInventarioSessionUser = MargenSessionSedeScope;

export type AnalisisInventarioResolvedScope =
  | {
      ok: true;
      sourceTable: RotacionSourceTable;
      matview: string;
      /** null = sin filtro de sede (solo admin). */
      sedePairs: Array<{ empresa: string; sedeId: string }> | null;
      columns: AnalisisInventarioSedeColumn[];
    }
  | { ok: false; error: string; status: 400 | 403 };

const parseSedeKey = (
  key: string,
): { empresa: string; sedeId: string } | null => {
  const [empresaRaw, idCoRaw] = key.split("|");
  const empresa = (empresaRaw ?? "").trim().toLowerCase();
  const sedeId = (idCoRaw ?? "").trim().padStart(3, "0");
  if (!empresa || !/^\d{3}$/.test(sedeId)) return null;
  return { empresa, sedeId };
};

/**
 * Alcance por sedes del usuario + tenant (historico vs Dinastia).
 * No mezcla Dinastia con otras empresas.
 */
export const resolveAnalisisInventarioScope = (
  sessionUser: AnalisisInventarioSessionUser,
): AnalisisInventarioResolvedScope => {
  const sedeScope = resolveMargenSedeScope(sessionUser);
  if (!sedeScope.authorized) {
    return {
      ok: false,
      error: "No tienes sedes asignadas para este módulo.",
      status: 403,
    };
  }

  const kind = resolveDataSourceKind(
    sessionUser,
    userIsDinastiaOnly(sessionUser) ? [DINASTIA_EMPRESA_CODE] : [],
  );
  if (!kind.ok) {
    return { ok: false, error: kind.error, status: 400 };
  }

  const sourceTable =
    kind.kind === "dinastia" ? ROTACION_SOURCE_DINASTIA : ROTACION_SOURCE_LEGACY;
  const matview = resolveRotacionCleanMatview(sourceTable);

  const catalog = filterMargenSedeCatalogForUser(sessionUser).filter((option) =>
    kind.kind === "dinastia"
      ? option.empresa === DINASTIA_EMPRESA_CODE
      : option.empresa !== DINASTIA_EMPRESA_CODE,
  );

  if (catalog.length === 0) {
    return {
      ok: false,
      error: "No tienes sedes asignadas para este módulo.",
      status: 403,
    };
  }

  const columns: AnalisisInventarioSedeColumn[] = catalog.map((option) => ({
    key: option.value,
    label: option.label,
    empresa: option.empresa,
    sedeId: option.idCo,
  }));

  if (sessionUser.role === "admin" && sedeScope.allowedKeys === null) {
    return {
      ok: true,
      sourceTable,
      matview,
      sedePairs: columns.map((col) => ({
        empresa: col.empresa,
        sedeId: col.sedeId,
      })),
      columns,
    };
  }

  const allowedKeys = sedeScope.allowedKeys ?? [];
  const sedePairs = allowedKeys
    .map(parseSedeKey)
    .filter((pair): pair is { empresa: string; sedeId: string } => pair !== null)
    .filter((pair) =>
      kind.kind === "dinastia"
        ? pair.empresa === DINASTIA_EMPRESA_CODE
        : pair.empresa !== DINASTIA_EMPRESA_CODE,
    );

  if (sedePairs.length === 0) {
    return {
      ok: false,
      error: "No tienes sedes asignadas para este módulo.",
      status: 403,
    };
  }

  const pairSet = new Set(
    sedePairs.map((pair) => `${pair.empresa}|${pair.sedeId}`),
  );
  const scopedColumns = columns.filter((col) => pairSet.has(col.key));

  return {
    ok: true,
    sourceTable,
    matview,
    sedePairs,
    columns: scopedColumns.length > 0 ? scopedColumns : columns.filter((col) =>
      sedePairs.some(
        (pair) => pair.empresa === col.empresa && pair.sedeId === col.sedeId,
      ),
    ),
  };
};

export const buildSedePairSqlFilter = (
  params: unknown[],
  sedePairs: Array<{ empresa: string; sedeId: string }> | null,
): string => {
  if (!sedePairs) return "TRUE";
  if (sedePairs.length === 0) return "FALSE";
  params.push(
    sedePairs.map((pair) => pair.empresa),
    sedePairs.map((pair) => pair.sedeId),
  );
  const empresaParam = params.length - 1;
  const sedeParam = params.length;
  return `(LOWER(TRIM(empresa)), LPAD(TRIM(sede_id::text), 3, '0')) IN (
    SELECT * FROM UNNEST($${empresaParam}::text[], $${sedeParam}::text[]) AS t(empresa, sede_id)
  )`;
};
