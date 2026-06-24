import { TUTORIAL_STATE_KEYS } from "@/lib/ui/tutorial-keys";
import {
  fetchTutorialCompletedRemote,
  persistTutorialCompletedRemote,
} from "@/lib/ui/product-tour/persist";

/** @deprecated Usar API genérica `/api/ui-state/tutorial`. */
export const fetchRotacionTourCompletedRemote = async (): Promise<
  boolean | null
> => fetchTutorialCompletedRemote(TUTORIAL_STATE_KEYS.rotacion);

/** @deprecated Usar API genérica `/api/ui-state/tutorial`. */
export const persistRotacionTourCompletedRemote = async (): Promise<boolean> =>
  persistTutorialCompletedRemote(TUTORIAL_STATE_KEYS.rotacion);
