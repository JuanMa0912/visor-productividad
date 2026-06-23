import { useCallback, useEffect, useRef } from "react";
import {
  isRotacionTourCompleted,
  startRotacionTour,
} from "./rotacion-tour";

const ROTACION_TOUR_AUTO_START_DELAY_MS = 900;

export const useRotacionTour = (
  userId: string | null | undefined,
  ready: boolean,
) => {
  const autoStartAttemptedRef = useRef(false);

  const startTour = useCallback(() => {
    window.setTimeout(() => {
      startRotacionTour({ userId });
    }, 120);
  }, [userId]);

  useEffect(() => {
    if (!ready || autoStartAttemptedRef.current) return;
    if (isRotacionTourCompleted(userId)) return;

    autoStartAttemptedRef.current = true;
    const timer = window.setTimeout(() => {
      startRotacionTour({ userId });
    }, ROTACION_TOUR_AUTO_START_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [ready, userId]);

  return { startTour };
};
