import type { ChecklistCatalogEntry } from "@/lib/checklists/types";
import { BODEGA_BLOCKS } from "@/lib/checklists/bodega-gerencial";
import { PUNTO_VENTA_BLOCKS, PUNTO_VENTA_ITEM_COUNT } from "@/lib/checklists/punto-venta";

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
    id: "punto-venta",
    title: "Checklist de Punto de Venta",
    subtitle: "Auditoría PVTA de surtido, precio, exhibición y gestión comercial",
    badge: "OPERACIÓN",
    puntos: PUNTO_VENTA_ITEM_COUNT,
    bloques: PUNTO_VENTA_BLOCKS.length,
    status: "available",
    href: "/checklists/punto-venta",
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

export const checklistItemLabel = (checklistId: string, key: string): string => {
  if (checklistId === "bodega-gerencial") {
    const code = Number(key);
    const item = BODEGA_BLOCKS.flatMap((block) => block.q).find(
      (entry) => entry.c === code,
    );
    return item?.x ?? key;
  }
  if (checklistId === "punto-venta") {
    for (const block of PUNTO_VENTA_BLOCKS) {
      const item = block.items.find((entry) => entry.id === key);
      if (item) return item.text;
    }
  }
  return key;
};
