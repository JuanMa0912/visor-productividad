import type { DriveStep } from "driver.js";
import {
  VENTAS_X_ITEM_TOUR_ANCHOR,
  ventasXItemTourSelector,
} from "./ventas-x-item-tour-anchors";

export const VENTAS_X_ITEM_TOUR_STEPS: DriveStep[] = [
  {
    element: ventasXItemTourSelector(VENTAS_X_ITEM_TOUR_ANCHOR.intro),
    popover: {
      title: "Ventas por ítem",
      description:
        "Consulta unidades diarias por empresa, sede e ítem. Vuelve a ver esta guía con Ayuda en el encabezado.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: ventasXItemTourSelector(VENTAS_X_ITEM_TOUR_ANCHOR.loadDb),
    popover: {
      title: "Carga desde base de datos",
      description:
        "Al entrar se cargan todas las empresas y el mes corrido del último dato. Ajusta fechas o empresas y pulsa Recargar si necesitas otro rango.",
      side: "top",
      align: "start",
    },
  },
  {
    element: ventasXItemTourSelector(VENTAS_X_ITEM_TOUR_ANCHOR.items),
    popover: {
      title: "Ítems y empresas visibles",
      description:
        "Filtra hasta 10 ítems y las empresas que quieres analizar sobre los datos ya cargados. El límite de ítems evita tablas demasiado anchas.",
      side: "top",
      align: "start",
    },
  },
  {
    element: ventasXItemTourSelector(VENTAS_X_ITEM_TOUR_ANCHOR.results),
    popover: {
      title: "Tabla diaria",
      description:
        "Unidades por día y sede con total diario (T. Dia). Los domingos se resaltan en rojo para lectura rápida.",
      side: "top",
      align: "start",
    },
  },
  {
    element: ventasXItemTourSelector(VENTAS_X_ITEM_TOUR_ANCHOR.charts),
    popover: {
      title: "Gráficas",
      description:
        "Tendencia diaria, barras apiladas por sede, mapa de calor y acumulado del rango para comparar participación.",
      side: "top",
      align: "start",
    },
  },
  {
    element: ventasXItemTourSelector(VENTAS_X_ITEM_TOUR_ANCHOR.export),
    popover: {
      title: "Exportar",
      description:
        "Descarga CSV, Excel, imagen o PDF con los mismos filtros visibles. Ideal para compartir el corte actual.",
      side: "left",
      align: "end",
    },
  },
];
