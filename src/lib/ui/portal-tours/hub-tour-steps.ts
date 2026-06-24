import type { HubSectionTheme } from "@/components/portal/hub-section-cards";
import type { DriveStep } from "driver.js";

const PREFIX = "portal-hub-tour";

export const PORTAL_HUB_TOUR_ANCHOR = {
  hero: `${PREFIX}-hero`,
  modules: `${PREFIX}-modules`,
} as const;

export const portalHubTourSelector = (id: string): string => `#${id}`;

const HUB_COPY: Record<
  HubSectionTheme,
  { title: string; hero: string; modules: string }
> = {
  venta: {
    title: "Hub de Venta",
    hero:
      "Resume el enfoque comercial de esta sección y cuántos módulos tienes disponibles.",
    modules:
      "Cada tarjeta abre un tablero: ventas por ítem, inventario consolidado o análisis de inventario.",
  },
  producto: {
    title: "Hub de Producto",
    hero:
      "Aquí conectas el resultado con su causa: líneas, márgenes y rotación por sede.",
    modules:
      "Elige el módulo según la pregunta: desempeño por línea, rentabilidad o inventario lento.",
  },
  operacion: {
    title: "Hub de Operación",
    hero:
      "Mide cómo se ejecuta el negocio con horas, marcaciones y programación de turnos.",
    modules:
      "Consulta operativa, comparación planilla vs asistencia o registro de horarios según tu permiso.",
  },
};

export const buildPortalHubTourSteps = (
  theme: HubSectionTheme,
): DriveStep[] => {
  const copy = HUB_COPY[theme];
  return [
    {
      element: portalHubTourSelector(PORTAL_HUB_TOUR_ANCHOR.hero),
      popover: {
        title: copy.title,
        description: copy.hero,
        side: "bottom",
        align: "start",
      },
    },
    {
      element: portalHubTourSelector(PORTAL_HUB_TOUR_ANCHOR.modules),
      popover: {
        title: "Módulos disponibles",
        description: copy.modules,
        side: "top",
        align: "start",
      },
    },
  ];
};
