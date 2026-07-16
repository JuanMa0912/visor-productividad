"use client";

import { useMemo } from "react";
import { prepareInformeData } from "@/lib/informe-variacion/aggregate";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

type Prepared = ReturnType<typeof prepareInformeData>;

/** Reusa prepare() entre cortes del mismo mes (mismo objeto de payload en memoria). */
const preparedByPayload = new WeakMap<InformeVariacionPayload, Prepared>();

const scheduleIdle = (fn: () => void): (() => void) => {
  if (typeof requestIdleCallback !== "undefined") {
    const id = requestIdleCallback(fn, { timeout: 2_000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
};

const getOrBuildPrepared = (payload: InformeVariacionPayload): Prepared => {
  const hit = preparedByPayload.get(payload);
  if (hit) return hit;
  const next = prepareInformeData(payload);
  preparedByPayload.set(payload, next);
  return next;
};

/**
 * Precalcula indices en idle cuando un rango entra al cache de memoria.
 * Asi el clic de corte reusa el resultado y no muestra "Indexando…".
 */
export const prefetchPrepareInformeData = (
  payload: InformeVariacionPayload,
): void => {
  if (preparedByPayload.has(payload)) return;
  if (typeof window === "undefined") return;
  scheduleIdle(() => {
    if (preparedByPayload.has(payload)) return;
    preparedByPayload.set(payload, prepareInformeData(payload));
  });
};

/**
 * Indices + contexto del payload.
 * Con prefetch previo el cambio de corte es sync (WeakMap hit).
 * Sin prefetch, construye una vez y cachea el resultado.
 */
export const usePreparedInformeData = (
  payload: InformeVariacionPayload,
): Prepared => useMemo(() => getOrBuildPrepared(payload), [payload]);
