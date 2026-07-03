import type { AuthUser } from "@/lib/auth/types";
import { mapRawSedeToCanonical } from "@/lib/horarios/planilla-sede";
import type {
  AbcdConfig,
  RotationApiResponse,
  RotationRow,
} from "./rotacion-preamble";
import { readRotationApiForbiddenMessage } from "./rotacion-preamble";

export type RotacionSedeOption = {
  value: string;
  empresa: string;
  sedeId: string;
  sedeName: string;
};

export type RotacionRowsFetchResult = {
  rows: RotationRow[];
  abcdConfig?: AbcdConfig;
};

const inFlightFetches = new Map<string, Promise<RotacionRowsFetchResult | null>>();

export const buildUserLastSedeStorageKey = (
  baseKey: string,
  userId: string | null | undefined,
): string => (userId ? `${baseKey}.${userId}` : baseKey);

const normalizeSedeToken = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

/** Coincide hint de perfil (sede / allowedSedes) con opcion del catalogo. */
export const sedeOptionMatchesUserHint = (
  hint: string,
  option: Pick<RotacionSedeOption, "sedeName" | "sedeId">,
): boolean => {
  const trimmed = hint.trim();
  if (!trimmed) return false;

  const canonical = (mapRawSedeToCanonical(trimmed) || trimmed).trim();
  const tokens = new Set(
    [trimmed, canonical]
      .map((value) => normalizeSedeToken(value))
      .filter(Boolean),
  );
  const name = normalizeSedeToken(option.sedeName);
  const id = normalizeSedeToken(option.sedeId);

  for (const token of tokens) {
    if (token === name || token === id) return true;
    if (/^\d+$/.test(token) && /^\d+$/.test(id)) {
      if (parseInt(token, 10) === parseInt(id, 10)) return true;
    }
    if (token.length >= 5 && (name.includes(token) || token.includes(name))) {
      return true;
    }
  }
  return false;
};

export const readUserLastSedeSelection = (
  baseKey: string,
  userId: string | null | undefined,
  validValues: Set<string>,
): string[] => {
  const scopedKey = buildUserLastSedeStorageKey(baseKey, userId);
  const keysToTry = userId ? [scopedKey, baseKey] : [baseKey];

  for (const key of keysToTry) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      const restored = parsed
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0 && validValues.has(value));
      if (restored.length === 0) continue;
      if (userId && key !== scopedKey) {
        localStorage.setItem(scopedKey, JSON.stringify(restored));
      }
      return restored;
    } catch {
      /* ignore corrupt storage */
    }
  }
  return [];
};

/**
 * Sedes cuyas filas conviene precargar antes de que el usuario espere la tabla.
 * Con mas de una sede en catalogo solo precarga seleccion explicita o ultima
 * eleccion guardada; nunca todas las sedes visibles.
 */
export const resolveRotacionPrefetchSedeValues = (input: {
  authUser: Pick<AuthUser, "id" | "role" | "sede" | "allowedSedes"> | null;
  allSedeOptions: RotacionSedeOption[];
  selectedSedeValues: string[];
  lastSedeStorageKey: string;
}): string[] => {
  const valid = new Set(input.allSedeOptions.map((option) => option.value));
  const selected = input.selectedSedeValues.filter((value) => valid.has(value));
  if (selected.length > 0) return selected;

  if (input.allSedeOptions.length > 1) {
    return readUserLastSedeSelection(
      input.lastSedeStorageKey,
      input.authUser?.id,
      valid,
    );
  }

  if (input.allSedeOptions.length === 1) {
    return [input.allSedeOptions[0]!.value];
  }

  return [];
};

export const getInFlightRotacionRowsFetch = (
  cacheKey: string,
): Promise<RotacionRowsFetchResult | null> | undefined =>
  inFlightFetches.get(cacheKey);

export async function fetchRotacionRowsForCache(input: {
  apiBasePath: string;
  cacheKey: string;
  start: string;
  end: string;
  sedeSelections: Array<{ empresa: string; sedeId: string }>;
  signal?: AbortSignal;
  onUnauthorized?: () => void;
  onForbidden?: (message: string) => void;
}): Promise<RotacionRowsFetchResult | null> {
  const existing = inFlightFetches.get(input.cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<RotacionRowsFetchResult | null> => {
    try {
      const params = new URLSearchParams();
      params.set("start", input.start);
      params.set("end", input.end);
      input.sedeSelections.forEach((sede) => {
        params.append("sedeScope", `${sede.empresa}::${sede.sedeId}`);
      });

      const response = await fetch(
        `${input.apiBasePath}?${params.toString()}`,
        { cache: "no-store", signal: input.signal },
      );

      if (response.status === 401) {
        input.onUnauthorized?.();
        return null;
      }
      if (response.status === 403) {
        input.onForbidden?.(await readRotationApiForbiddenMessage(response));
        return null;
      }

      const payload = (await response.json()) as RotationApiResponse;
      if (!response.ok) {
        throw new Error(
          payload.error ?? "No fue posible consultar la rotacion.",
        );
      }

      return {
        rows: payload.rows ?? [],
        abcdConfig:
          input.sedeSelections.length === 1
            ? payload.meta?.abcdConfig
            : undefined,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      throw err;
    } finally {
      inFlightFetches.delete(input.cacheKey);
    }
  })();

  inFlightFetches.set(input.cacheKey, promise);
  return promise;
}
