import {
  buildRotacionCriticalDigest,
  type RotacionCriticalDigest,
} from "@/lib/rotacion/critical-digest";
import {
  buildRotacionCriticalDigestConsolidatedHtml,
  buildRotacionCriticalDigestConsolidatedSubject,
  buildRotacionCriticalDigestConsolidatedText,
} from "@/lib/rotacion/critical-digest-consolidated-email";
import {
  loadRotacionCriticalDigestSource,
  resolveRotacionCriticalDigestSharedContext,
} from "@/lib/rotacion/server/load-critical-digest-source";
import {
  resolveRotacionEmailSedes,
  type RotacionEmailSede,
} from "@/lib/rotacion/server/resolve-email-sedes";

const CACHE_TTL_MS = 5 * 60 * 1000;
const SEDE_CONCURRENCY = 3;

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];
  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex]!);
    }
  };
  await Promise.all(Array.from({ length: safeLimit }, () => runWorker()));
  return results;
};

export type RotacionConsolidatedDigestBundle = {
  digests: RotacionCriticalDigest[];
  sedes: RotacionEmailSede[];
  range: { start: string; end: string };
};

export type RotacionConsolidatedDigestReport = {
  subject: string;
  html: string;
  text: string;
  range: { start: string; end: string };
  sedeCount: number;
  generatedAt: string;
  cacheHit: boolean;
};

type CachedBundle = {
  value: RotacionConsolidatedDigestBundle;
  expiresAt: number;
};

type CachedReport = {
  value: Omit<RotacionConsolidatedDigestReport, "cacheHit">;
  expiresAt: number;
};

let bundleCache: CachedBundle | null = null;
let bundleInFlight: Promise<RotacionConsolidatedDigestBundle> | null = null;
let reportCache: CachedReport | null = null;
let reportInFlight: Promise<RotacionConsolidatedDigestReport> | null = null;

const sedeKey = (sede: Pick<RotacionEmailSede, "empresa" | "sedeId">) =>
  `${sede.empresa}::${sede.sedeId}`;

/**
 * Digests de todas las sedes del correo consolidado (rango rolling month).
 * Cache en memoria 5 min y coalescing de requests concurrentes.
 */
export async function loadAllRotacionCriticalDigests(options?: {
  bypassCache?: boolean;
}): Promise<RotacionConsolidatedDigestBundle> {
  if (
    !options?.bypassCache &&
    bundleCache &&
    bundleCache.expiresAt > Date.now()
  ) {
    return bundleCache.value;
  }
  if (!options?.bypassCache && bundleInFlight) return bundleInFlight;

  bundleInFlight = (async () => {
    const [sedes, shared] = await Promise.all([
      resolveRotacionEmailSedes(),
      resolveRotacionCriticalDigestSharedContext(),
    ]);
    if (!shared) {
      throw new Error("No hay rango disponible de rotacion.");
    }
    if (sedes.length === 0) {
      throw new Error("No hay sedes para armar el informe de rotacion.");
    }

    const sources = await mapWithConcurrency(sedes, SEDE_CONCURRENCY, async (sede) => {
      try {
        return await loadRotacionCriticalDigestSource(
          {
            empresa: sede.empresa,
            sedeId: sede.sedeId,
            sedeName: sede.sedeName,
          },
          shared,
        );
      } catch (error) {
        console.error(
          `[rotacion-informe] Error al cargar ${sede.sedeName}:`,
          error,
        );
        return null;
      }
    });

    const byKey = new Map<string, RotacionCriticalDigest>();
    sedes.forEach((sede, index) => {
      const source = sources[index];
      if (!source) {
        console.warn(
          `[rotacion-informe] Sin digest para ${sede.sedeName} (${sede.empresa}/${sede.sedeId}).`,
        );
        return;
      }
      byKey.set(sedeKey(sede), buildRotacionCriticalDigest(source));
    });

    const digests = sedes
      .map((sede) => byKey.get(sedeKey(sede)))
      .filter((digest): digest is RotacionCriticalDigest => Boolean(digest));

    if (digests.length === 0) {
      throw new Error("No hay datos de rotacion para el informe consolidado.");
    }

    const value: RotacionConsolidatedDigestBundle = {
      digests,
      sedes,
      range: shared.boundedRange,
    };
    bundleCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  })().finally(() => {
    bundleInFlight = null;
  });

  return bundleInFlight;
}

/** HTML/asunto del correo consolidado (todas las sedes). Cache 5 min. */
export async function loadRotacionConsolidatedDigestReport(): Promise<RotacionConsolidatedDigestReport> {
  if (reportCache && reportCache.expiresAt > Date.now()) {
    return { ...reportCache.value, cacheHit: true };
  }
  if (reportInFlight) return reportInFlight;

  reportInFlight = (async () => {
    const bundle = await loadAllRotacionCriticalDigests();
    const generatedAt = new Date().toISOString();
    const value: Omit<RotacionConsolidatedDigestReport, "cacheHit"> = {
      subject: buildRotacionCriticalDigestConsolidatedSubject(bundle.digests),
      html: buildRotacionCriticalDigestConsolidatedHtml(bundle.digests),
      text: buildRotacionCriticalDigestConsolidatedText(bundle.digests),
      range: bundle.range,
      sedeCount: bundle.digests.length,
      generatedAt,
    };
    reportCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return { ...value, cacheHit: false };
  })().finally(() => {
    reportInFlight = null;
  });

  return reportInFlight;
}
