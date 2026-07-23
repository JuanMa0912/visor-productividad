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

export const mergeDinastiaIntoRotationCatalog = <
  T extends {
    companies: string[];
    sedes: Array<{ empresa: string; sedeId: string; sedeName: string }>;
  },
>(
  catalog: T,
): T => {
  const seen = new Set(
    catalog.sedes.map((sede) => `${sede.empresa}::${sede.sedeId}`),
  );
  const sedes = [...catalog.sedes];
  for (const entry of DINASTIA_ROTACION_SEDES) {
    const key = `${entry.empresa}::${entry.sedeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sedes.push({ ...entry });
  }
  const companies = Array.from(
    new Set([...catalog.companies, "dinastia"]),
  ).sort((a, b) => a.localeCompare(b, "es"));
  return { ...catalog, companies, sedes };
};
