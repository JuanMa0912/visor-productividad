import type { ChecklistCatalogEntry } from "@/lib/checklists/types";
import { BODEGA_BLOCKS } from "@/lib/checklists/bodega-gerencial";

export const CHECKLIST_CATALOG: ChecklistCatalogEntry[] = [
  {
    id: "bodega-gerencial",
    title: "Checklist de Bodega",
    subtitle: "Tablero gerencial de auditoría ponderada por sede",
    badge: "OPERACIÓN",
    puntos: BODEGA_BLOCKS.reduce((a, b) => a + b.q.length, 0),
    bloques: BODEGA_BLOCKS.length,
    status: "available",
    href: "/checklists/bodega-gerencial",
  },
  {
    id: "sala-comercial",
    title: "Checklist de Sala",
    subtitle: "Próximamente — seguimiento de piso de venta",
    badge: "PRÓXIMO",
    puntos: 0,
    bloques: 0,
    status: "coming_soon",
    href: "/checklists/sala-comercial",
  },
  {
    id: "cajas-operacion",
    title: "Checklist de Cajas",
    subtitle: "Próximamente — control de caja y servicio",
    badge: "PRÓXIMO",
    puntos: 0,
    bloques: 0,
    status: "coming_soon",
    href: "/checklists/cajas-operacion",
  },
];

export const getChecklistCatalogEntry = (id: string) =>
  CHECKLIST_CATALOG.find((entry) => entry.id === id) ?? null;
