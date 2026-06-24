import { useProductTour } from "@/lib/ui/product-tour/use-product-tour";
import { TUTORIAL_LOCAL_STORAGE_KEYS, TUTORIAL_STATE_KEYS } from "@/lib/ui/tutorial-keys";
import { ROTACION_TOUR_STEPS } from "./rotacion-tour-steps";

export type RotacionTourCompletionStatus = "loading" | "completed" | "pending";

export const useRotacionTour = (
  userId: string | null | undefined,
  ready: boolean,
  tableTourReady: boolean,
) =>
  useProductTour({
    localStorageKey: TUTORIAL_LOCAL_STORAGE_KEYS.rotacion,
    stateKey: TUTORIAL_STATE_KEYS.rotacion,
    steps: ROTACION_TOUR_STEPS,
    theme: "amber",
    userId,
    ready,
    contentReady: tableTourReady,
  });
