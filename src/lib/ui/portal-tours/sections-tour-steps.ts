import type { DriveStep } from "driver.js";
import type { PortalSectionId } from "@/lib/shared/portal-sections";
import {
  PORTAL_SECTIONS_TOUR_ANCHOR,
  portalSectionsTourSelector,
} from "./sections-anchors";

export const buildPortalSectionsTourSteps = (
  visibleSectionIds: PortalSectionId[],
): DriveStep[] => {
  const steps: DriveStep[] = [
    {
      element: portalSectionsTourSelector(PORTAL_SECTIONS_TOUR_ANCHOR.intro),
      popover: {
        title: "Bienvenido al Portal UAID",
        description:
          "Desde aquí eliges la dimensión del negocio que quieres analizar: venta, producto u operación.",
        side: "bottom",
        align: "start",
      },
    },
    {
      element: portalSectionsTourSelector(PORTAL_SECTIONS_TOUR_ANCHOR.grid),
      popover: {
        title: "Tres dimensiones",
        description:
          "Cada tarjeta abre un hub con módulos relacionados. Solo ves las secciones a las que tienes acceso.",
        side: "top",
        align: "start",
      },
    },
  ];

  for (const sectionId of visibleSectionIds) {
    const labels: Record<PortalSectionId, { title: string; description: string }> =
      {
        venta: {
          title: "Sección Venta",
          description:
            "Resultado comercial: ventas por ítem, inventario y análisis frente a la venta.",
        },
        producto: {
          title: "Sección Producto",
          description:
            "Causa del resultado: productividad, márgenes y rotación de inventario.",
        },
        operacion: {
          title: "Sección Operación",
          description:
            "Ejecución: horarios, marcaciones, jornadas extendidas y registro de turnos.",
        },
      };
    const copy = labels[sectionId];
    steps.push({
      element: portalSectionsTourSelector(
        PORTAL_SECTIONS_TOUR_ANCHOR.card(sectionId),
      ),
      popover: {
        title: copy.title,
        description: copy.description,
        side: "top",
        align: "start",
      },
    });
  }

  return steps;
};
