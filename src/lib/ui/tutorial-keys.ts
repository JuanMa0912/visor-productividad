/** Claves JSONB en `app_user_ui_state.state`. */
export const TUTORIAL_STATE_KEYS = {
  rotacion: "rotacionTutorialV1",
  portalSections: "portalSectionsTutorialV1",
  portalHubVenta: "portalHubVentaTutorialV1",
  portalHubProducto: "portalHubProductoTutorialV1",
  portalHubOperacion: "portalHubOperacionTutorialV1",
  jornadaExtendida: "jornadaExtendidaTutorialV1",
  ventasXItem: "ventasXItemTutorialV1",
  inventarioXItem: "inventarioXItemTutorialV1",
  margenes: "margenesTutorialV1",
} as const;

export type TutorialStateKey =
  (typeof TUTORIAL_STATE_KEYS)[keyof typeof TUTORIAL_STATE_KEYS];

/** Claves localStorage (prefijo por tour). */
export const TUTORIAL_LOCAL_STORAGE_KEYS = {
  rotacion: "rotacion:tutorial-completed:v1",
  portalSections: "portal:tutorial:secciones:v1",
  portalHubVenta: "portal:tutorial:hub-venta:v1",
  portalHubProducto: "portal:tutorial:hub-producto:v1",
  portalHubOperacion: "portal:tutorial:hub-operacion:v1",
  jornadaExtendida: "portal:tutorial:jornada-extendida:v1",
  ventasXItem: "portal:tutorial:ventas-x-item:v1",
  inventarioXItem: "portal:tutorial:inventario-x-item:v1",
  margenes: "portal:tutorial:margenes:v1",
} as const;

export type TutorialLocalStorageKey =
  (typeof TUTORIAL_LOCAL_STORAGE_KEYS)[keyof typeof TUTORIAL_LOCAL_STORAGE_KEYS];

export const readTutorialCompletedFromState = (
  state: unknown,
  key: TutorialStateKey,
): boolean => {
  if (!state || typeof state !== "object") return false;
  return (state as Record<string, unknown>)[key] === true;
};
