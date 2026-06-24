import { driver, type DriveStep, type Driver } from "driver.js";
import type { TutorialLocalStorageKey, TutorialStateKey } from "@/lib/ui/tutorial-keys";
import { persistTutorialCompletedRemote } from "./persist";
import { markTourCompletedLocally } from "./storage";
import {
  productTourHighlightRgb,
  productTourPopoverClass,
  type ProductTourTheme,
} from "./themes";

export const PRODUCT_TOUR_START_DELAY_MS = 120;
export const PRODUCT_TOUR_AUTO_START_DELAY_MS = 900;
export const PRODUCT_TOUR_AUTO_START_MAX_WAIT_MS = 12_000;

export const resolveActiveProductTourSteps = (steps: DriveStep[]): DriveStep[] =>
  steps.filter((step) => {
    const selector = step.element;
    if (!selector || typeof selector !== "string") return false;
    return Boolean(document.querySelector(selector));
  });

export type StartProductTourOptions = {
  steps: DriveStep[];
  theme?: ProductTourTheme;
  localStorageKey: TutorialLocalStorageKey;
  stateKey: TutorialStateKey;
  userId?: string | null;
  skipPersist?: boolean;
};

let activeDriver: Driver | null = null;

export const destroyProductTour = (): void => {
  activeDriver?.destroy();
  activeDriver = null;
};

export const startProductTour = (
  options: StartProductTourOptions,
): boolean => {
  if (typeof window === "undefined") return false;

  const steps = resolveActiveProductTourSteps(options.steps);
  if (steps.length === 0) return false;

  destroyProductTour();

  const theme = options.theme ?? "portal";
  const popoverClass = productTourPopoverClass(theme);
  const highlightRgb = productTourHighlightRgb(theme);

  document.documentElement.style.setProperty(
    "--product-tour-highlight-rgb",
    highlightRgb,
  );

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
    popoverClass,
    steps,
    onDestroyed: () => {
      activeDriver = null;
      document.documentElement.style.removeProperty("--product-tour-highlight-rgb");
      if (!options.skipPersist) {
        markTourCompletedLocally(options.localStorageKey, options.userId);
        void persistTutorialCompletedRemote(options.stateKey);
      }
    },
  });

  activeDriver = driverObj;
  driverObj.drive();
  return true;
};

export const scheduleProductTourStart = (
  options: StartProductTourOptions,
  delayMs = PRODUCT_TOUR_START_DELAY_MS,
  attempt = 0,
): void => {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    const started = startProductTour(options);
    if (!started && attempt < 4) {
      scheduleProductTourStart(
        options,
        Math.min(250 * (attempt + 1), 800),
        attempt + 1,
      );
    }
  }, delayMs);
};
