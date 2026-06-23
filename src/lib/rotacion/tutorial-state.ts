/** Clave en app_user_ui_state.state para el tutorial de Rotacion v1. */
export const ROTACION_TUTORIAL_STATE_KEY = "rotacionTutorialV1";

export type RotacionTutorialStateResponse = {
  completed: boolean;
};

export const readRotacionTutorialCompletedFromState = (
  state: unknown,
): boolean => {
  if (!state || typeof state !== "object") return false;
  return (state as Record<string, unknown>)[ROTACION_TUTORIAL_STATE_KEY] === true;
};
