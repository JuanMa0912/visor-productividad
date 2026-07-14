import type { AuthUser } from "@/lib/auth/types";
import { ALLOWED_LINE_SET } from "@/lib/shared/constants";

/** Línea de productividad / horas (tabla ventas_asadero). */
export const ASADERO_LINE_ID = "asadero";

/** id_tipo en margen_final / margen_item_dia_roll (categoría Asaderos). */
export const ASADERO_MARGEN_TIPO_ID = "3";

/** categoria_key en rotación. */
export const ASADERO_ROTACION_CATEGORIA_KEY = "3";

export type UserLineCategoryScope = {
  allowedLineIds: string[];
  forcedMargenTipos: string[] | null;
  forcedRotacionCategoriaKeys: string[] | null;
  /** La UI no debe permitir salir de la categoría forzada. */
  locked: boolean;
};

const normalizeLineId = (value: string) => value.trim().toLowerCase();

export const resolveUserLineCategoryScope = (
  allowedLines: string[] | null | undefined,
): UserLineCategoryScope => {
  if (!Array.isArray(allowedLines) || allowedLines.length === 0) {
    return {
      allowedLineIds: [],
      forcedMargenTipos: null,
      forcedRotacionCategoriaKeys: null,
      locked: false,
    };
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
      forcedRotacionCategoriaKeys: [ASADERO_ROTACION_CATEGORIA_KEY],
      locked: true,
    };
  }

  return {
    allowedLineIds,
    forcedMargenTipos: null,
    forcedRotacionCategoriaKeys: null,
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

export const scopeTiposCacheSuffix = (
  forcedMargenTipos: string[] | null | undefined,
): string => {
  if (!forcedMargenTipos?.length) return "";
  return `:tipos=${[...forcedMargenTipos].sort().join(",")}`;
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
