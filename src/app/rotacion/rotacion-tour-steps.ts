import type { DriveStep } from "driver.js";
import { ROTACION_TOUR_ANCHOR, rotacionTourSelector } from "./rotacion-tour-anchors";

export const ROTACION_TOUR_STEPS: DriveStep[] = [
  {
    element: rotacionTourSelector(ROTACION_TOUR_ANCHOR.intro),
    popover: {
      title: "Bienvenido a Rotación",
      description:
        "Guía rápida por consulta, tabla, filtros y exportación. Vuelve a verla cuando quieras con Ayuda.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: rotacionTourSelector(ROTACION_TOUR_ANCHOR.filters),
    popover: {
      title: "Empresa y sede",
      description:
        "Elige al menos una sede para cargar la tabla. Varias sedes se ven consolidadas o por bloque, y también en Excel.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: rotacionTourSelector(ROTACION_TOUR_ANCHOR.dates),
    popover: {
      title: "Período de consulta",
      description:
        "Por defecto: mes anterior completo. Puedes acotar el rango (máx. 2 meses) según datos disponibles.",
      side: "left",
      align: "start",
    },
  },
  {
    element: rotacionTourSelector(ROTACION_TOUR_ANCHOR.lineFilters),
    popover: {
      title: "Familias y líneas",
      description:
        "Reduce el universo por familias y líneas N1/N2. Para ordenar por categoría (CAT) usa la flecha en el encabezado de la tabla.",
      side: "top",
      align: "start",
    },
  },
  {
    element: rotacionTourSelector(ROTACION_TOUR_ANCHOR.abcdConfig),
    popover: {
      title: "Configurar ABCD",
      description:
        "Define los porcentajes que clasifican ítems en A, B, C y D. Los cambios aplican en la siguiente consulta.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: rotacionTourSelector(ROTACION_TOUR_ANCHOR.table),
    popover: {
      title: "Tabla de rotación",
      description:
        "Cada bloque muestra venta, inventario, rotación (DIC), DI y DUV. Abajo hay filtros locales (Venta ≤, Inv ≥, DIC ≥) sin volver a consultar.",
      side: "top",
      align: "start",
    },
  },
  {
    element: rotacionTourSelector(ROTACION_TOUR_ANCHOR.tableAbcd),
    popover: {
      title: "ABCD y restock",
      description:
        "Filtra por clase A–D, cero rotación, restock, ítems nuevos o sobrestock (32+ / 50+ días de inventario). Los contadores indican cuántos ítems hay en cada grupo.",
      side: "left",
      align: "start",
    },
  },
  {
    element: rotacionTourSelector(ROTACION_TOUR_ANCHOR.tableFilters),
    popover: {
      title: "Filtros rápidos",
      description:
        "Cero rotación, topes de venta e inventario, y chips S.inventario al filtrar cero o restock. En restock, arriba ves sin verificar / seguimiento / surtido. Si el ítem ya está surtido, en la fila puedes tomar la foto. La columna Auditar se activa cuando hay evidencia.",
      side: "top",
      align: "start",
    },
  },
  {
    element: rotacionTourSelector(ROTACION_TOUR_ANCHOR.tableSearch),
    popover: {
      title: "Buscar producto",
      description:
        "Filtra por código o nombre sin recargar. Combínalo con ABCD y los filtros rápidos; la exportación respeta la vista.",
      side: "top",
      align: "start",
    },
  },
  {
    element: rotacionTourSelector(ROTACION_TOUR_ANCHOR.export),
    popover: {
      title: "Exportar",
      description:
        "Excel o PDF con los mismos filtros visibles. Con varias sedes, Excel permite elegir cuáles incluir en un solo archivo.",
      side: "left",
      align: "end",
    },
  },
];
