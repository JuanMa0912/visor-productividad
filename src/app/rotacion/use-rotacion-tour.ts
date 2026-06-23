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

export type RotacionTourCompletionStatus = "loading" | "completed" | "pending";

export const useRotacionTour = (
  userId: string | null | undefined,
  ready: boolean,
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

    autoStartAttemptedRef.current = true;
    const timer = window.setTimeout(() => {
      startRotacionTour({ userId });
    }, ROTACION_TOUR_AUTO_START_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [ready, completionStatus, userId]);

  return { startTour, completionStatus };
};
