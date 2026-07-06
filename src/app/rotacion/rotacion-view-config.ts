import { ROTACION_SOURCE_LEGACY } from "@/lib/rotacion/source-tables";

export type RotacionViewConfig = {
  apiBasePath: string;
  sourceTable: typeof ROTACION_SOURCE_LEGACY;
  pageTitle: string;
  pageBadge: string;
  pageDescription: string;
  lastSedeStorageKey: string;
  exportFilePrefix: string;
};

export const ROTACION_LEGACY_VIEW: RotacionViewConfig = {
  apiBasePath: "/api/rotacion",
  sourceTable: ROTACION_SOURCE_LEGACY,
  pageTitle: "Rotacion",
  pageBadge: "ROTACION",
  pageDescription:
    "Esta vista toma datos reales desde la base diaria para detectar productos de baja rotacion, agotados y futuros agotados por sede, usando la venta acumulada del rango consultado.",
  lastSedeStorageKey: "rotacion.lastSedeSelection",
  exportFilePrefix: "rotacion",
};
