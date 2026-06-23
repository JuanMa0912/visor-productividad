import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRotacionTourCompletedRemote } from "./rotacion-tour-persist";
import {
  ROTACION_TOUR_AUTO_START_DELAY_MS,
  ROTACION_TOUR_AUTO_START_MAX_WAIT_MS,
  isRotacionTourCompleted,
  markRotacionTourCompleted,
  scheduleRotacionTourStart,
  startRotacionTour,
} from "./rotacion-tour";

export type RotacionTourCompletionStatus = "loading" | "completed" | "pending";

export const useRotacionTour = (
  userId: string | null | undefined,
  ready: boolean,
  tableTourReady: boolean,
) => {
  const autoStartAttemptedRef = useRef(false);
  const [completionStatus, setCompletionStatus] =
    useState<RotacionTourCompletionStatus>("loading");

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    void (async () => {
      if (isRotacionTourCompleted(userId)) {
        if (!cancelled) setCompletionStatus("completed");
        return;
      }

      const remoteCompleted = await fetchRotacionTourCompletedRemote();
      if (cancelled) return;

      if (remoteCompleted === true) {
        markRotacionTourCompleted(userId);
        setCompletionStatus("completed");
        return;
      }

      setCompletionStatus("pending");
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, userId]);

  const startTour = useCallback(() => {
    scheduleRotacionTourStart({ userId });
  }, [userId]);

  useEffect(() => {
    if (!ready || completionStatus !== "pending") return;
    if (autoStartAttemptedRef.current) return;

    const delayMs = tableTourReady
      ? ROTACION_TOUR_AUTO_START_DELAY_MS
      : ROTACION_TOUR_AUTO_START_MAX_WAIT_MS;

    const timer = window.setTimeout(() => {
      if (autoStartAttemptedRef.current) return;
      autoStartAttemptedRef.current = true;
      startRotacionTour({ userId });
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [ready, completionStatus, userId, tableTourReady]);

  return { startTour, completionStatus };
};
