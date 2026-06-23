import { driver, type Driver } from "driver.js";
import { ROTACION_TOUR_STEPS } from "./rotacion-tour-steps";
import { persistRotacionTourCompletedRemote } from "./rotacion-tour-persist";

export const ROTACION_TOUR_STORAGE_KEY = "rotacion:tutorial-completed:v1";

/** Retraso breve para que el DOM termine de pintar antes de medir anclas. */
export const ROTACION_TOUR_START_DELAY_MS = 120;

/** Espera tras cargar tabla antes del auto-inicio. */
export const ROTACION_TOUR_AUTO_START_DELAY_MS = 900;

/** Si la tabla no carga, mostramos el tour base tras este tope. */
export const ROTACION_TOUR_AUTO_START_MAX_WAIT_MS = 12_000;

export const buildRotacionTourStorageKey = (
  userId: string | null | undefined,
): string =>
  userId
    ? `${ROTACION_TOUR_STORAGE_KEY}.${userId}`
    : ROTACION_TOUR_STORAGE_KEY;

export const isRotacionTourCompleted = (
  userId: string | null | undefined,
): boolean => {
  if (typeof window === "undefined") return true;
  try {
    return (
      window.localStorage.getItem(buildRotacionTourStorageKey(userId)) === "1"
    );
  } catch {
    return true;
  }
};

export const markRotacionTourCompleted = (
  userId: string | null | undefined,
): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(buildRotacionTourStorageKey(userId), "1");
  } catch {
    /* quota / private mode */
  }
};

export const clearRotacionTourCompleted = (
  userId: string | null | undefined,
): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(buildRotacionTourStorageKey(userId));
  } catch {
    /* ignore */
  }
};

export const resolveActiveRotacionTourSteps = () =>
  ROTACION_TOUR_STEPS.filter((step) => {
    const selector = step.element;
    if (!selector || typeof selector !== "string") return false;
    return Boolean(document.querySelector(selector));
  });

export type StartRotacionTourOptions = {
  userId?: string | null;
  /** Si true, no guarda completado al cerrar (útil para pruebas). */
  skipPersist?: boolean;
};

let activeDriver: Driver | null = null;

export const destroyRotacionTour = (): void => {
  activeDriver?.destroy();
  activeDriver = null;
};

export const startRotacionTour = (
  options: StartRotacionTourOptions = {},
): boolean => {
  if (typeof window === "undefined") return false;

  const steps = resolveActiveRotacionTourSteps();
  if (steps.length === 0) return false;

  destroyRotacionTour();

  const driverObj = driver({
    animate: true,
    showProgress: true,
    progressText: "{{current}} de {{total}}",
    nextBtnText: "Siguiente",
    prevBtnText: "Anterior",
    doneBtnText: "Listo",
    allowClose: true,
    allowKeyboardControl: true,
    overlayColor: "#0f172a",
    overlayOpacity: 0.55,
    smoothScroll: true,
    stagePadding: 10,
    stageRadius: 14,
    popoverOffset: 12,
    popoverClass: "rotacion-tour-popover",
    steps,
    onDestroyed: () => {
      activeDriver = null;
      if (!options.skipPersist) {
        markRotacionTourCompleted(options.userId);
        void persistRotacionTourCompletedRemote();
      }
    },
  });

  activeDriver = driverObj;
  driverObj.drive();
  return true;
};

export const scheduleRotacionTourStart = (
  options: StartRotacionTourOptions = {},
  delayMs = ROTACION_TOUR_START_DELAY_MS,
): void => {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    startRotacionTour(options);
  }, delayMs);
};
