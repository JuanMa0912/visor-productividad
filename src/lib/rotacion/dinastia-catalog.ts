/**
 * Semilla estatica de sedes Dinastia para el catalogo de rotacion.
 * La tabla historica / periodo_std no las incluye; sin esto el admin no
 * puede elegir Dinastia en el UI.
 */
export const DINASTIA_ROTACION_SEDES = [
  {
    empresa: "dinastia",
    sedeId: "001",
    sedeName: "Dinastia 1 Santa Elena",
  },
  {
    empresa: "dinastia",
    sedeId: "002",
    sedeName: "Dinastia 2 CR Primera",
  },
] as const;

const normalizeSedeIdToken = (value: string) => {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(3, "0");
  return trimmed;
};

const sedeCatalogKey = (empresa: string, sedeId: string) =>
  `${empresa.trim().toLowerCase()}::${normalizeSedeIdToken(sedeId)}`;

export const mergeDinastiaIntoRotationCatalog = <
  T extends {
    companies: string[];
    sedes: Array<{ empresa: string; sedeId: string; sedeName: string }>;
  },
>(
  catalog: T,
): T => {
  const seen = new Set(
    catalog.sedes.map((sede) => sedeCatalogKey(sede.empresa, sede.sedeId)),
  );
  const sedes = [...catalog.sedes];
  for (const entry of DINASTIA_ROTACION_SEDES) {
    const key = sedeCatalogKey(entry.empresa, entry.sedeId);
    if (seen.has(key)) continue;
    seen.add(key);
    sedes.push({ ...entry });
  }
  const companies = Array.from(
    new Set([...catalog.companies, "dinastia"]),
  ).sort((a, b) => a.localeCompare(b, "es"));
  return { ...catalog, companies, sedes };
};
