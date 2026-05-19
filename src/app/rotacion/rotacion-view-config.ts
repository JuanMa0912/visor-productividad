import {
  ROTACION_SOURCE_LEGACY,
  ROTACION_SOURCE_V4,
} from "@/lib/rotacion/source-tables";

export type RotacionViewConfig = {
  apiBasePath: string;
  sourceTable: typeof ROTACION_SOURCE_LEGACY | typeof ROTACION_SOURCE_V4;
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

export const ROTACION_V4_VIEW: RotacionViewConfig = {
  apiBasePath: "/api/rotacion-dos",
  sourceTable: ROTACION_SOURCE_V4,
  pageTitle: "Rotacion v4",
  pageBadge: "ROTACION V4",
  pageDescription:
    "Misma vista de rotacion alimentada desde la tabla rotacion_v4 (datos diarios de prueba). La rotacion en /rotacion sigue usando la tabla anterior.",
  lastSedeStorageKey: "rotacion-dos.lastSedeSelection",
  exportFilePrefix: "rotacion_v4",
};
