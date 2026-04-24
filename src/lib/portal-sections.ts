export type PortalSectionId = "venta" | "producto" | "operacion";
export type PortalSubsectionId =
  | "ventas-x-item"
  | "inventario-x-item"
  | "analisis-de-inventario"
  | "mix-y-linea"
  | "margenes"
  | "rotacion"
  | "consulta-operativa"
  | "planilla-vs-asistencia"
  | "registro-de-horarios";

export type PortalSectionDefinition = {
  id: PortalSectionId;
  label: string;
  focus: string;
  description: string;
  href: string;
  modules: string[];
};

export const PORTAL_SECTIONS: PortalSectionDefinition[] = [
  {
    id: "venta",
    label: "Venta",
    focus: "Muestra el resultado del negocio",
    description:
      "Facilita una lectura rapida del desempeno comercial, tendencias y variaciones por sede, linea o producto.",
    href: "/venta",
    modules: ["Ventas por item", "Inventario x item", "Análisis de inventario"],
  },
  {
    id: "producto",
    label: "Producto",
    focus: "Explica ese resultado",
    description:
      "Identifica que categorias o items impulsan o afectan la venta en terminos de productividad, rentabilidad y participacion.",
    href: "/productividad",
    modules: ["Productividad", "Margenes", "Rotacion", "Prediccion pedidos"],
  },
  {
    id: "operacion",
    label: "Operacion",
    focus: "Evalua la ejecucion",
    description:
      "Mide que tan eficiente es el uso de los recursos (horas, personal y horarios) para generar la venta.",
    href: "/horario",
    modules: ["Horarios", "Registro de horarios"],
  },
];

export const PORTAL_SUBSECTIONS_BY_SECTION: Record<
  PortalSectionId,
  PortalSubsectionId[]
> = {
  venta: ["ventas-x-item", "inventario-x-item", "analisis-de-inventario"],
  producto: ["mix-y-linea", "margenes", "rotacion"],
  operacion: [
    "consulta-operativa",
    "planilla-vs-asistencia",
    "registro-de-horarios",
  ],
};

const PORTAL_SECTION_ALIAS_MAP: Record<string, PortalSectionId> = {
  venta: "venta",
  "inventario-x-item": "venta",
  "analisis-de-inventario": "venta",
  "ventas-x-item": "venta",
  producto: "producto",
  productividad: "producto",
  margenes: "producto",
  rotacion: "producto",
  "prediccion-pedidos": "producto",
  "margenes-operativos": "producto",
  operacion: "operacion",
  "operacion-es": "operacion",
  horario: "operacion",
  horarios: "operacion",
  "jornada-extendida": "operacion",
  "ingresar-horarios": "operacion",
  "horarios-guardados": "operacion",
};

const PORTAL_SUBSECTION_ALIAS_MAP: Record<string, PortalSubsectionId> = {
  "ventas-x-item": "ventas-x-item",
  ventas: "ventas-x-item",
  "inventario-x-item": "inventario-x-item",
  "analisis-de-inventario": "analisis-de-inventario",
  "mix-y-linea": "mix-y-linea",
  "productividad-home": "mix-y-linea",
  productividad: "mix-y-linea",
  "margenes-operativos": "margenes",
  margenes: "margenes",
  rotacion: "rotacion",
  "consulta-operativa": "consulta-operativa",
  "jornada-extendida": "consulta-operativa",
  "planilla-vs-asistencia": "planilla-vs-asistencia",
  "horarios-comparar": "planilla-vs-asistencia",
  "registro-de-horarios": "registro-de-horarios",
  "ingresar-horarios": "registro-de-horarios",
  "horarios-guardados": "registro-de-horarios",
};

const normalizePortalSectionToken = (value?: string | null) =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export const resolvePortalSectionId = (value?: string | null): PortalSectionId | null =>
  PORTAL_SECTION_ALIAS_MAP[normalizePortalSectionToken(value)] ?? null;

export const resolvePortalSubsectionId = (
  value?: string | null,
): PortalSubsectionId | null =>
  PORTAL_SUBSECTION_ALIAS_MAP[normalizePortalSectionToken(value)] ?? null;

export const normalizeAllowedPortalSections = (
  value: unknown,
): PortalSectionId[] | null => {
  if (!Array.isArray(value)) return null;

  return Array.from(
    new Set(
      value
        .map((entry) =>
          typeof entry === "string" ? resolvePortalSectionId(entry) : null,
        )
        .filter((entry): entry is PortalSectionId => entry !== null),
    ),
  );
};

export const normalizeAllowedPortalSubsections = (
  value: unknown,
): PortalSubsectionId[] | null => {
  if (!Array.isArray(value)) return null;
  return Array.from(
    new Set(
      value
        .map((entry) =>
          typeof entry === "string" ? resolvePortalSubsectionId(entry) : null,
        )
        .filter((entry): entry is PortalSubsectionId => entry !== null),
    ),
  );
};

export const canAccessPortalSection = (
  allowedSections: unknown,
  requiredSection: PortalSectionId,
) => {
  const normalized = normalizeAllowedPortalSections(allowedSections);
  if (normalized === null) return true;
  return normalized.includes(requiredSection);
};

export const canAccessPortalSubsection = (
  allowedSubsections: unknown,
  requiredSubsection: PortalSubsectionId,
) => {
  const normalized = normalizeAllowedPortalSubsections(allowedSubsections);
  if (normalized === null) return true;
  return normalized.includes(requiredSubsection);
};

export const PORTAL_SECTION_LABEL_BY_ID = new Map(
  PORTAL_SECTIONS.map((section) => [section.id, section.label]),
);
