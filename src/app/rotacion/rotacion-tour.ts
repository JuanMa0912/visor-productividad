import { driver, type DriveStep, type Driver } from "driver.js";
import { persistRotacionTourCompletedRemote } from "./rotacion-tour-persist";

export const ROTACION_TOUR_STORAGE_KEY = "rotacion:tutorial-completed:v1";

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

const ROTACION_TOUR_STEP_DEFS: DriveStep[] = [
  {
    element: "#rotacion-tour-intro",
    popover: {
      title: "Bienvenido a Rotacion",
      description:
        "Este recorrido muestra lo esencial: filtros, periodo, tabla y exportacion. Puedes repetirlo cuando quieras con el boton Ayuda.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#rotacion-tour-filters",
    popover: {
      title: "Empresa y sede",
      description:
        "Marca al menos una sede para cargar la tabla. Puedes elegir varias sedes y verlas consolidadas o exportarlas por separado.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#rotacion-tour-dates",
    popover: {
      title: "Periodo de consulta",
      description:
        "Por defecto se usa el mes anterior completo. Puedes acotar el rango (maximo 2 meses) segun los datos disponibles.",
      side: "left",
      align: "start",
    },
  },
  {
    element: "#rotacion-tour-line-filters",
    popover: {
      title: "Familias, lineas y categorias",
      description:
        "Acota el universo de productos antes de consultar. La tabla se actualiza sola al cambiar estos filtros.",
      side: "top",
      align: "start",
    },
  },
  {
    element: "#rotacion-tour-table",
    popover: {
      title: "Tabla de rotacion",
      description:
        "Cada bloque muestra items con venta, inventario, rotacion (DIC), DI y DUV. Usa los filtros de la tabla (ABCD, cero rotacion, Venta ≤) para enfocar el analisis.",
      side: "top",
      align: "start",
    },
  },
  {
    element: "#rotacion-tour-export",
    popover: {
      title: "Exportar resultados",
      description:
        "Descarga Excel o PDF con los mismos filtros visibles. Si puedes ver varias sedes, Excel te deja elegir cuales incluir en un solo archivo.",
      side: "left",
      align: "end",
    },
  },
];

const resolveActiveTourSteps = (): DriveStep[] =>
  ROTACION_TOUR_STEP_DEFS.filter((step) => {
    const selector = step.element;
    if (!selector || typeof selector !== "string") return false;
    return Boolean(document.querySelector(selector));
  });

export type StartRotacionTourOptions = {
  userId?: string | null;
  /** Si true, no guarda completado al cerrar (util para pruebas). */
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

  const steps = resolveActiveTourSteps();
  if (steps.length === 0) return false;

  destroyRotacionTour();

  const driverObj = driver({
    showProgress: true,
    progressText: "{{current}} de {{total}}",
    nextBtnText: "Siguiente",
    prevBtnText: "Anterior",
    doneBtnText: "Listo",
    allowClose: true,
    overlayOpacity: 0.58,
    smoothScroll: true,
    stagePadding: 8,
    stageRadius: 12,
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
