import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TutorialLocalStorageKey, TutorialStateKey } from "@/lib/ui/tutorial-keys";
import type { ProductTourTheme } from "./themes";
import type { DriveStep } from "driver.js";
import {
  PRODUCT_TOUR_AUTO_START_DELAY_MS,
  PRODUCT_TOUR_AUTO_START_MAX_WAIT_MS,
  scheduleProductTourStart,
  startProductTour,
} from "./driver-tour";
import { fetchTutorialCompletedRemote } from "./persist";
import { isTourCompletedLocally, markTourCompletedLocally } from "./storage";

export type ProductTourCompletionStatus = "loading" | "completed" | "pending";

export type UseProductTourConfig = {
  localStorageKey: TutorialLocalStorageKey;
  stateKey: TutorialStateKey;
  steps: DriveStep[];
  theme?: ProductTourTheme;
  userId?: string | null;
  ready: boolean;
  contentReady?: boolean;
  autoStart?: boolean;
};

export const useProductTour = (config: UseProductTourConfig) => {
  const {
    localStorageKey,
    stateKey,
    steps,
    theme,
    userId,
    ready,
    contentReady = true,
    autoStart = true,
  } = config;

  const autoStartAttemptedRef = useRef(false);
  const [completionStatus, setCompletionStatus] =
    useState<ProductTourCompletionStatus>("loading");

  const tourOptions = useMemo(
    () => ({
      steps,
      theme,
      localStorageKey,
      stateKey,
      userId,
    }),
    [steps, theme, localStorageKey, stateKey, userId],
  );

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    void (async () => {
      if (isTourCompletedLocally(localStorageKey, userId)) {
        if (!cancelled) setCompletionStatus("completed");
        return;
      }

      const remoteCompleted = await fetchTutorialCompletedRemote(stateKey);
      if (cancelled) return;

      if (remoteCompleted === true) {
        markTourCompletedLocally(localStorageKey, userId);
        setCompletionStatus("completed");
        return;
      }

      setCompletionStatus("pending");
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, userId, localStorageKey, stateKey]);

  const startTour = useCallback(() => {
    scheduleProductTourStart(tourOptions);
  }, [tourOptions]);

  useEffect(() => {
    if (!autoStart || !ready || completionStatus !== "pending") return;
    if (autoStartAttemptedRef.current) return;

    const delayMs = contentReady
      ? PRODUCT_TOUR_AUTO_START_DELAY_MS
      : PRODUCT_TOUR_AUTO_START_MAX_WAIT_MS;

    const timer = window.setTimeout(() => {
      if (autoStartAttemptedRef.current) return;
      const started = startProductTour(tourOptions);
      if (started) {
        autoStartAttemptedRef.current = true;
        return;
      }
      scheduleProductTourStart(tourOptions, 300, 0);
      autoStartAttemptedRef.current = true;
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [
    autoStart,
    ready,
    completionStatus,
    contentReady,
    tourOptions,
  ]);

  return { startTour, completionStatus };
};
