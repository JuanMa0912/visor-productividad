import type { AuthUser } from "@/lib/auth/types";
import { ALLOWED_LINE_SET } from "@/lib/shared/constants";

/** Línea de productividad / horas (tabla ventas_asadero). */
export const ASADERO_LINE_ID = "asadero";

/** id_tipo en margen_final / margen_item_dia_roll (categoría Asaderos). */
export const ASADERO_MARGEN_TIPO_ID = "3";

/** categoria_key en rotación. */
export const ASADERO_ROTACION_CATEGORIA_KEY = "3";

/** Línea de productividad / horas (tabla ventas_fruver). */
export const FRUVER_LINE_ID = "fruver";

/**
 * id_linea1 en margen / informe (línea Fruver dentro de Mercado u otras cats).
 * Fruver no es categoría propia como Asaderos (3); se acota por línea N1.
 */
export const FRUVER_MARGEN_LINEA_ID = "01";

/** linea_n1_codigo en rotación. */
export const FRUVER_ROTACION_LINEA_N1 = "01";

export type UserLineCategoryScope = {
  allowedLineIds: string[];
  forcedMargenTipos: string[] | null;
  forcedMargenLineas: string[] | null;
  forcedRotacionCategoriaKeys: string[] | null;
  forcedRotacionLineaN1: string[] | null;
  /** La UI no debe permitir salir de la categoría/línea forzada. */
  locked: boolean;
};

const normalizeLineId = (value: string) => value.trim().toLowerCase();

/** Normaliza códigos N1 tipo "1" / "01". */
export const normalizeScopedLineaN1 = (value: string): string => {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(2, "0");
  return trimmed;
};

const emptyScope = (): UserLineCategoryScope => ({
  allowedLineIds: [],
  forcedMargenTipos: null,
  forcedMargenLineas: null,
  forcedRotacionCategoriaKeys: null,
  forcedRotacionLineaN1: null,
  locked: false,
});

export const resolveUserLineCategoryScope = (
  allowedLines: string[] | null | undefined,
): UserLineCategoryScope => {
  if (!Array.isArray(allowedLines) || allowedLines.length === 0) {
    return emptyScope();
  }

  const allowedLineIds = Array.from(
    new Set(
      allowedLines
        .map((line) => (typeof line === "string" ? normalizeLineId(line) : ""))
        .filter((line) => line && ALLOWED_LINE_SET.has(line)),
    ),
  );

  const onlyAsadero =
    allowedLineIds.length === 1 && allowedLineIds[0] === ASADERO_LINE_ID;

  if (onlyAsadero) {
    return {
      allowedLineIds: [ASADERO_LINE_ID],
      forcedMargenTipos: [ASADERO_MARGEN_TIPO_ID],
      forcedMargenLineas: null,
      forcedRotacionCategoriaKeys: [ASADERO_ROTACION_CATEGORIA_KEY],
      forcedRotacionLineaN1: null,
      locked: true,
    };
  }

  const onlyFruver =
    allowedLineIds.length === 1 && allowedLineIds[0] === FRUVER_LINE_ID;

  if (onlyFruver) {
    return {
      allowedLineIds: [FRUVER_LINE_ID],
      forcedMargenTipos: null,
      forcedMargenLineas: [FRUVER_MARGEN_LINEA_ID],
      forcedRotacionCategoriaKeys: null,
      forcedRotacionLineaN1: [FRUVER_ROTACION_LINEA_N1],
      locked: true,
    };
  }

  return {
    allowedLineIds,
    forcedMargenTipos: null,
    forcedMargenLineas: null,
    forcedRotacionCategoriaKeys: null,
    forcedRotacionLineaN1: null,
    locked: false,
  };
};

export const resolveSessionLineCategoryScope = (
  user: Pick<AuthUser, "role" | "allowedLines">,
): UserLineCategoryScope => {
  if (user.role === "admin") {
    return resolveUserLineCategoryScope(null);
  }
  return resolveUserLineCategoryScope(user.allowedLines);
};

export const applyMargenCategoriaScope = (
  categorias: string[],
  scope: UserLineCategoryScope,
): string[] => {
  if (!scope.forcedMargenTipos?.length) return categorias;
  if (categorias.length === 0) return [...scope.forcedMargenTipos];
  const forced = new Set(scope.forcedMargenTipos);
  const intersected = categorias
    .map((value) => value.trim())
    .filter((value) => forced.has(value));
  return intersected.length > 0 ? intersected : [...scope.forcedMargenTipos];
};

export const applyMargenLineaScope = (
  lineas: string[],
  scope: UserLineCategoryScope,
): string[] => {
  if (!scope.forcedMargenLineas?.length) return lineas;
  if (lineas.length === 0) return [...scope.forcedMargenLineas];
  const forced = new Set(
    scope.forcedMargenLineas.map((value) => normalizeScopedLineaN1(value)),
  );
  const intersected = lineas
    .map((value) => normalizeScopedLineaN1(value))
    .filter((value) => forced.has(value));
  return intersected.length > 0 ? intersected : [...scope.forcedMargenLineas];
};

export const applyRotacionCategoriaKeysScope = (
  categoriaKeys: string[] | null,
  scope: UserLineCategoryScope,
): string[] | null => {
  if (!scope.forcedRotacionCategoriaKeys?.length) return categoriaKeys;
  if (!categoriaKeys || categoriaKeys.length === 0) {
    return [...scope.forcedRotacionCategoriaKeys];
  }
  const forced = new Set(scope.forcedRotacionCategoriaKeys);
  const intersected = categoriaKeys.filter((key) => forced.has(key));
  return intersected.length > 0
    ? intersected
    : [...scope.forcedRotacionCategoriaKeys];
};

export const applyRotacionLineaN1Scope = (
  lineasN1: string[] | null,
  scope: UserLineCategoryScope,
): string[] | null => {
  if (!scope.forcedRotacionLineaN1?.length) return lineasN1;
  const forcedList = scope.forcedRotacionLineaN1.map(normalizeScopedLineaN1);
  if (!lineasN1 || lineasN1.length === 0) {
    return [...forcedList];
  }
  const forced = new Set(forcedList);
  const intersected = lineasN1
    .map(normalizeScopedLineaN1)
    .filter((code) => forced.has(code));
  return intersected.length > 0 ? intersected : [...forcedList];
};

export const scopeTiposCacheSuffix = (
  forcedMargenTipos: string[] | null | undefined,
): string => {
  if (!forcedMargenTipos?.length) return "";
  return `:tipos=${[...forcedMargenTipos].sort().join(",")}`;
};

export const scopeLineasCacheSuffix = (
  forcedMargenLineas: string[] | null | undefined,
): string => {
  if (!forcedMargenLineas?.length) return "";
  return `:lin=${[...forcedMargenLineas].map(normalizeScopedLineaN1).sort().join(",")}`;
};

/**
 * Predicado SQL de categorias en rotacion.
 * Por defecto excluye Asaderos (3) y V; con perfil bloqueado (asaderos)
 * solo permite las categorias forzadas.
 */
export const resolveRotacionCategoriaPresenceSql = (
  fields: {
    categoriaKeyExpr: string;
    allowedCategoriaExpr: string;
  },
  forcedCategoriaKeys: string[] | null | undefined,
): string => {
  if (!forcedCategoriaKeys?.length) {
    return fields.allowedCategoriaExpr;
  }
  const safeKeys = forcedCategoriaKeys
    .map((key) => key.trim())
    .filter((key) => /^[0-9A-Za-z_]+$/.test(key));
  if (safeKeys.length === 0) return "FALSE";
  return `${fields.categoriaKeyExpr} = ANY(ARRAY[${safeKeys
    .map((key) => `'${key}'`)
    .join(", ")}]::text[])`;
};

export const rotacionCategoriaScopeCacheSuffix = (
  forcedCategoriaKeys: string[] | null | undefined,
): string => {
  if (!forcedCategoriaKeys?.length) return "";
  return `:cat=${[...forcedCategoriaKeys].sort().join(",")}`;
};

export const rotacionLineaN1ScopeCacheSuffix = (
  forcedLineaN1: string[] | null | undefined,
): string => {
  if (!forcedLineaN1?.length) return "";
  return `:n1=${[...forcedLineaN1].map(normalizeScopedLineaN1).sort().join(",")}`;
};
