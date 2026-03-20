export type PortalSectionId = "venta" | "producto" | "operacion";

export type PortalSectionDefinition = {
  id: PortalSectionId;
  label: string;
  description: string;
  href: string;
  modules: string[];
};

export const PORTAL_SECTIONS: PortalSectionDefinition[] = [
  {
    id: "venta",
    label: "Venta",
    description:
      "Analisis detallado del comportamiento de productos y ventas por item para consulta directa.",
    href: "/ventas-x-item",
    modules: ["Ventas por item"],
  },
  {
    id: "producto",
    label: "Producto",
    description:
      "Seguimiento de productividad, rentabilidad y comparativos por sede para entender el desempeno del negocio.",
    href: "/productividad",
    modules: ["Productividad", "Margenes"],
  },
  {
    id: "operacion",
    label: "Operacion",
    description:
      "Consulta de horas trabajadas, control operativo del personal y registro de horarios.",
    href: "/horario",
    modules: ["Horarios", "Registro de horarios"],
  },
];

const PORTAL_SECTION_ALIAS_MAP: Record<string, PortalSectionId> = {
  venta: "venta",
  "ventas-x-item": "venta",
  producto: "producto",
  productividad: "producto",
  margenes: "producto",
  "margenes-operativos": "producto",
  operacion: "operacion",
  "operacion-es": "operacion",
  horario: "operacion",
  horarios: "operacion",
  "jornada-extendida": "operacion",
  "ingresar-horarios": "operacion",
};

const normalizePortalSectionToken = (value?: string | null) =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export const resolvePortalSectionId = (value?: string | null): PortalSectionId | null =>
  PORTAL_SECTION_ALIAS_MAP[normalizePortalSectionToken(value)] ?? null;

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

export const canAccessPortalSection = (
  allowedSections: unknown,
  requiredSection: PortalSectionId,
) => {
  const normalized = normalizeAllowedPortalSections(allowedSections);
  if (normalized === null) return true;
  return normalized.includes(requiredSection);
};

export const PORTAL_SECTION_LABEL_BY_ID = new Map(
  PORTAL_SECTIONS.map((section) => [section.id, section.label]),
);
