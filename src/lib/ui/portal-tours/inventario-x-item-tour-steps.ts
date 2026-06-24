import type { DriveStep } from "driver.js";
import {
  INVENTARIO_X_ITEM_TOUR_ANCHOR,
  inventarioXItemTourSelector,
} from "./inventario-x-item-tour-anchors";

export const INVENTARIO_X_ITEM_TOUR_STEPS: DriveStep[] = [
  {
    element: inventarioXItemTourSelector(INVENTARIO_X_ITEM_TOUR_ANCHOR.intro),
    popover: {
      title: "Inventario x ítem",
      description:
        "Matriz de existencias por sede al corte del rango. Usa Ayuda en el encabezado para repetir esta guía.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: inventarioXItemTourSelector(INVENTARIO_X_ITEM_TOUR_ANCHOR.filters),
    popover: {
      title: "Filtros obligatorios",
      description:
        "Define fechas, empresa, sede, líneas, subcategoría e ítems (hasta 10). Completa el alcance antes de construir la matriz.",
      side: "top",
      align: "start",
    },
  },
  {
    element: inventarioXItemTourSelector(INVENTARIO_X_ITEM_TOUR_ANCHOR.presets),
    popover: {
      title: "Presets de ítems",
      description:
        "Guarda combinaciones frecuentes de ítems y aplícalas en un clic. Los presets se sincronizan con tu usuario.",
      side: "top",
      align: "start",
    },
  },
  {
    element: inventarioXItemTourSelector(INVENTARIO_X_ITEM_TOUR_ANCHOR.matrix),
    popover: {
      title: "Matriz de inventario",
      description:
        "Filas por sede y columnas por ítem con inventario, valor, vendido y DI. Ordena columnas y expande a pantalla completa si lo necesitas.",
      side: "top",
      align: "start",
    },
  },
  {
    element: inventarioXItemTourSelector(INVENTARIO_X_ITEM_TOUR_ANCHOR.export),
    popover: {
      title: "Exportar matriz",
      description:
        "PDF, Excel o imagen con la vista actual. Puedes exportar solo DI cuando quieras un reporte más liviano.",
      side: "left",
      align: "end",
    },
  },
];
