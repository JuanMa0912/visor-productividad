import {
  MERCAMIO_SEDES,
  MERCATODO_SEDES,
  MERKMIOS_SEDES,
  getSedeOrderIndexForRawName,
} from "@/lib/shared/constants";

/** Códigos de `orden_compra.empresa` (ETL: mercamio | mtodo | bogota). */
export const OC_EMPRESA_ORDER = ["mercamio", "mtodo", "bogota"] as const;

export type OcEmpresaCode = (typeof OC_EMPRESA_ORDER)[number];

const OC_EMPRESA_LABEL: Record<string, string> = {
  mercamio: "Mercamio",
  mtodo: "Mercatodo",
  bogota: "Merkmios",
};

const OC_EMPRESA_SEDES: Record<string, readonly string[]> = {
  mercamio: MERCAMIO_SEDES,
  mtodo: MERCATODO_SEDES,
  bogota: MERKMIOS_SEDES,
};

export function labelOcEmpresa(code: string): string {
  return OC_EMPRESA_LABEL[code.trim().toLowerCase()] ?? code;
}

export function sortOcEmpresas(empresas: string[]): string[] {
  return [...empresas].sort((a, b) => {
    const ia = OC_EMPRESA_ORDER.indexOf(a.trim().toLowerCase() as OcEmpresaCode);
    const ib = OC_EMPRESA_ORDER.indexOf(b.trim().toLowerCase() as OcEmpresaCode);
    const sa = ia < 0 ? Number.MAX_SAFE_INTEGER : ia;
    const sb = ib < 0 ? Number.MAX_SAFE_INTEGER : ib;
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b, "es");
  });
}

export function sortOcSedes(sedes: string[]): string[] {
  return [...sedes].sort((a, b) => {
    const ia = getSedeOrderIndexForRawName(a);
    const ib = getSedeOrderIndexForRawName(b);
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b, "es");
  });
}

export function parseOcMonthDay(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
}

export function ocSedeMatchesEmpresas(sede: string, empresas: string[]): boolean {
  if (empresas.length === 0) return true;
  const sedeIdx = getSedeOrderIndexForRawName(sede);
  return empresas.some((empresa) => {
    const group = OC_EMPRESA_SEDES[empresa.trim().toLowerCase()];
    if (!group) return true;
    return group.some((name) => getSedeOrderIndexForRawName(name) === sedeIdx);
  });
}
