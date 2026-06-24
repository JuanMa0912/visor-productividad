import type { HubSectionTheme } from "@/components/portal/hub-section-cards";
import {
  TUTORIAL_LOCAL_STORAGE_KEYS,
  TUTORIAL_STATE_KEYS,
} from "@/lib/ui/tutorial-keys";

export const PORTAL_HUB_TOUR_CONFIG = {
  venta: {
    theme: "venta" as const,
    localStorageKey: TUTORIAL_LOCAL_STORAGE_KEYS.portalHubVenta,
    stateKey: TUTORIAL_STATE_KEYS.portalHubVenta,
  },
  producto: {
    theme: "producto" as const,
    localStorageKey: TUTORIAL_LOCAL_STORAGE_KEYS.portalHubProducto,
    stateKey: TUTORIAL_STATE_KEYS.portalHubProducto,
  },
  operacion: {
    theme: "operacion" as const,
    localStorageKey: TUTORIAL_LOCAL_STORAGE_KEYS.portalHubOperacion,
    stateKey: TUTORIAL_STATE_KEYS.portalHubOperacion,
  },
} satisfies Record<
  HubSectionTheme,
  {
    theme: HubSectionTheme;
    localStorageKey: (typeof TUTORIAL_LOCAL_STORAGE_KEYS)[keyof typeof TUTORIAL_LOCAL_STORAGE_KEYS];
    stateKey: (typeof TUTORIAL_STATE_KEYS)[keyof typeof TUTORIAL_STATE_KEYS];
  }
>;
