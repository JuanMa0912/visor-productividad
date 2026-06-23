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
        "Recorrido por filtros de consulta, tabla, filtros de analisis y exportacion. Repitelo cuando quieras con el boton Ayuda.",
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
    element: "#rotacion-tour-abcd-config",
    popover: {
      title: "Configurar ABCD",
      description:
        "Define los porcentajes que clasifican items en A, B, C y D. Los cambios aplican en la siguiente consulta de rotacion.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: "#rotacion-tour-table",
    popover: {
      title: "Tabla de rotacion",
      description:
        "Cada bloque lista items con venta, inventario, rotacion (DIC), DI y DUV. Abajo veras filtros para enfocar el analisis sin volver a consultar.",
      side: "top",
      align: "start",
    },
  },
  {
    element: "#rotacion-tour-table-abcd",
    popover: {
      title: "Categorias ABCD y restock",
      description:
        "Filtra por clase de rotacion (A, B, C, D), cero rotacion, restock o nuevos.",
      side: "left",
      align: "start",
    },
  },
  {
    element: "#rotacion-tour-table-filters",
    popover: {
      title: "Filtros rapidos de tabla",
      description:
        "Cero rotacion: venta en cero con inventario. Venta ≤ e Inv ≥: escribe un valor y pulsa el boton para aplicar el tope. Los contadores entre parentesis muestran cuantos items quedarian. Al filtrar por cero rotacion o restock aparecen chips S.inventario para marcar el estado de surtido.",
      side: "top",
      align: "start",
    },
  },
  {
    element: "#rotacion-tour-table-search",
    popover: {
      title: "Buscar producto",
      description:
        "Filtra la tabla por codigo o nombre sin recargar datos. Combinalo con ABCD y los filtros rapidos; la exportacion respeta lo que ves.",
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
