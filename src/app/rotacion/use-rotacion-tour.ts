import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchRotacionTourCompletedRemote,
} from "./rotacion-tour-persist";
import {
  isRotacionTourCompleted,
  markRotacionTourCompleted,
  startRotacionTour,
} from "./rotacion-tour";

const ROTACION_TOUR_AUTO_START_DELAY_MS = 900;
/** Si la tabla tarda, igual mostramos el tour base tras este tope. */
const ROTACION_TOUR_AUTO_START_MAX_WAIT_MS = 12_000;

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
    window.setTimeout(() => {
      startRotacionTour({ userId });
    }, 120);
  }, [userId]);

  useEffect(() => {
    if (!ready || completionStatus !== "pending") return;
    if (autoStartAttemptedRef.current) return;

    const launchTour = () => {
      if (autoStartAttemptedRef.current) return;
      autoStartAttemptedRef.current = true;
      startRotacionTour({ userId });
    };

    if (tableTourReady) {
      const timer = window.setTimeout(
        launchTour,
        ROTACION_TOUR_AUTO_START_DELAY_MS,
      );
      return () => window.clearTimeout(timer);
    }

    const fallbackTimer = window.setTimeout(
      launchTour,
      ROTACION_TOUR_AUTO_START_MAX_WAIT_MS,
    );
    return () => window.clearTimeout(fallbackTimer);
  }, [ready, completionStatus, userId, tableTourReady]);

  return { startTour, completionStatus };
};
