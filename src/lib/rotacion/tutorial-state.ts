import {
  TUTORIAL_STATE_KEYS,
  readTutorialCompletedFromState,
} from "@/lib/ui/tutorial-keys";

/** @deprecated Usar `TUTORIAL_STATE_KEYS.rotacion`. */
export const ROTACION_TUTORIAL_STATE_KEY = TUTORIAL_STATE_KEYS.rotacion;

export type RotacionTutorialStateResponse = {
  completed: boolean;
};

export const readRotacionTutorialCompletedFromState = (
  state: unknown,
): boolean =>
  readTutorialCompletedFromState(state, ROTACION_TUTORIAL_STATE_KEY);
