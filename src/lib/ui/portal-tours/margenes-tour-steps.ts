import type { DriveStep } from "driver.js";
import { MARGENES_TOUR_ANCHOR, margenesTourSelector } from "./margenes-tour-anchors";

export const MARGENES_TOUR_STEPS: DriveStep[] = [
  {
    element: margenesTourSelector(MARGENES_TOUR_ANCHOR.intro),
    popover: {
      title: "Análisis de margen",
      description:
        "Tablero unificado sobre margen_final con drill por producto, factura y sede. Repite la guía con Ayuda en el encabezado del portal o en la barra del tablero.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: margenesTourSelector(MARGENES_TOUR_ANCHOR.filters),
    popover: {
      title: "Filtros de negocio",
      description:
        "Empresa, sede, fechas y jerarquía de producto acotarán ventas, costos y margen cuando el ETL esté disponible.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: margenesTourSelector(MARGENES_TOUR_ANCHOR.tabs),
    popover: {
      title: "Vistas de análisis",
      description:
        "Alterna entre producto, factura y sede para cambiar el nivel de detalle del drill-down.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: margenesTourSelector(MARGENES_TOUR_ANCHOR.kpi),
    popover: {
      title: "Indicadores clave",
      description:
        "Ventas netas, costo, margen en pesos y margen porcentual se actualizarán con los filtros activos.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: margenesTourSelector(MARGENES_TOUR_ANCHOR.main),
    popover: {
      title: "Área principal",
      description:
        "Aquí irán tablas y gráficos del margen unificado. Mientras tanto puedes revisar el estado de la tabla y el rango de fechas cargado.",
      side: "top",
      align: "center",
    },
  },
];
