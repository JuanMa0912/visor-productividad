import { ROTACION_TOUR_STEPS } from "./rotacion-tour-steps";
import {
  TUTORIAL_LOCAL_STORAGE_KEYS,
  TUTORIAL_STATE_KEYS,
} from "@/lib/ui/tutorial-keys";
import {
  PRODUCT_TOUR_AUTO_START_DELAY_MS,
  PRODUCT_TOUR_AUTO_START_MAX_WAIT_MS,
  PRODUCT_TOUR_START_DELAY_MS,
  destroyProductTour,
  scheduleProductTourStart,
  startProductTour,
} from "@/lib/ui/product-tour/driver-tour";
import {
  buildTourLocalStorageKey,
  clearTourCompletedLocally,
  isTourCompletedLocally,
  markTourCompletedLocally,
} from "@/lib/ui/product-tour/storage";

export const ROTACION_TOUR_STORAGE_KEY = TUTORIAL_LOCAL_STORAGE_KEYS.rotacion;

export {
  PRODUCT_TOUR_START_DELAY_MS as ROTACION_TOUR_START_DELAY_MS,
  PRODUCT_TOUR_AUTO_START_DELAY_MS as ROTACION_TOUR_AUTO_START_DELAY_MS,
  PRODUCT_TOUR_AUTO_START_MAX_WAIT_MS as ROTACION_TOUR_AUTO_START_MAX_WAIT_MS,
};

export const buildRotacionTourStorageKey = (
  userId: string | null | undefined,
): string => buildTourLocalStorageKey(ROTACION_TOUR_STORAGE_KEY, userId);

export const isRotacionTourCompleted = (
  userId: string | null | undefined,
): boolean => isTourCompletedLocally(ROTACION_TOUR_STORAGE_KEY, userId);

export const markRotacionTourCompleted = (
  userId: string | null | undefined,
): void => markTourCompletedLocally(ROTACION_TOUR_STORAGE_KEY, userId);

export const clearRotacionTourCompleted = (
  userId: string | null | undefined,
): void => clearTourCompletedLocally(ROTACION_TOUR_STORAGE_KEY, userId);

export type StartRotacionTourOptions = {
  userId?: string | null;
  skipPersist?: boolean;
};

const rotacionTourOptions = (options: StartRotacionTourOptions = {}) => ({
  steps: ROTACION_TOUR_STEPS,
  theme: "amber" as const,
  localStorageKey: TUTORIAL_LOCAL_STORAGE_KEYS.rotacion,
  stateKey: TUTORIAL_STATE_KEYS.rotacion,
  userId: options.userId,
  skipPersist: options.skipPersist,
});

export const destroyRotacionTour = destroyProductTour;

export const startRotacionTour = (
  options: StartRotacionTourOptions = {},
): boolean => startProductTour(rotacionTourOptions(options));

export const scheduleRotacionTourStart = (
  options: StartRotacionTourOptions = {},
  delayMs = PRODUCT_TOUR_START_DELAY_MS,
): void => scheduleProductTourStart(rotacionTourOptions(options), delayMs);
