import { getCanonicalSedeName } from "@/lib/shared/sede-names";

export type MargenViewMode = "producto" | "factura" | "sede";

export type MargenQueryFilters = {
  fromCompact: string;
  toCompact: string;
  fechas: string[];
  empresas: string[];
  sedes: string[];
  categorias: string[];
  lineas: string[];
  sublineas: string[];
  items: string[];
  orderBy?: string;
  orderDir?: "asc" | "desc";
};

const TIPO_LABELS: Record<string, string> = {
  "4": "MERCADO",
};

export const tipoLabel = (idTipo: string | null | undefined): string => {
  const id = String(idTipo ?? "").trim();
  return TIPO_LABELS[id] ?? (id || "—");
};

const EMPRESA_LABELS: Record<string, string> = {
  mercamio: "MERCAMIO",
  mtodo: "MERCATODO",
  mercatodo: "MERCATODO",
  bogota: "BOGOTA",
  merkmios: "MERKMIOS",
};

export const compactDateToIso = (compact: string | null | undefined): string | null => {
  if (!compact || !/^\d{8}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
};

export const isoDateToCompact = (iso: string | null | undefined): string | null => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return iso.replace(/-/g, "");
};

const parseList = (raw: string | null) =>
  (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const normalizeEmpresa = (value: string) => value.trim().toLowerCase();

/** Alias históricos BD → clave canónica de filtros. */
const EMPRESA_ALIASES: Record<string, string> = {
  mercatodo: "mtodo",
  merkmios: "bogota",
};

export const canonicalizeEmpresaKey = (value: string): string => {
  const normalized = normalizeEmpresa(value);
  return EMPRESA_ALIASES[normalized] ?? normalized;
};

const normalizeCo = (value: string) => value.trim().padStart(3, "0");

export const empresaLabel = (empresa: string | null | undefined): string => {
  const key = canonicalizeEmpresaKey(empresa ?? "");
  return EMPRESA_LABELS[key] ?? (empresa?.trim().toUpperCase() || "—");
};

export const sedeLabel = (
  empresa: string | null | undefined,
  idCo: string | null | undefined,
): string => {
  const co = normalizeCo(idCo ?? "");
  const emp = canonicalizeEmpresaKey(empresa ?? "");
  const canonical = getCanonicalSedeName(co, emp);
  if (canonical) return canonical;
  if (co && emp) return `${empresaLabel(emp)} ${co}`;
  return co || "—";
};

export const sedeKey = (empresa: string, idCo: string) =>
  `${canonicalizeEmpresaKey(empresa)}|${normalizeCo(idCo)}`;

export const parseSedeKey = (key: string): { empresa: string; idCo: string } | null => {
  const [empresa, idCo] = key.split("|");
  if (!empresa || !idCo) return null;
  return { empresa: canonicalizeEmpresaKey(empresa), idCo: normalizeCo(idCo) };
};

/** Filtra sedes (`empresa|idCo`) por las empresas seleccionadas en el tablero. */
export const filterSedeOptionsByEmpresas = <
  T extends { value: string; empresa?: string | null },
>(
  sedes: T[],
  selectedEmpresas: string[],
): T[] => {
  if (selectedEmpresas.length === 0) return sedes;
  const allowed = new Set(
    selectedEmpresas.map((value) => canonicalizeEmpresaKey(value)).filter(Boolean),
  );
  if (allowed.size === 0) return sedes;
  return sedes.filter((option) => {
    const fromKey = parseSedeKey(option.value)?.empresa;
    const fromField = option.empresa
      ? canonicalizeEmpresaKey(option.empresa)
      : null;
    const empresa = fromKey ?? fromField;
    return Boolean(empresa && allowed.has(empresa));
  });
};

export const parseMargenFilters = (
  searchParams: URLSearchParams,
  defaults?: { fromCompact?: string | null; toCompact?: string | null },
): MargenQueryFilters | { error: string } => {
  const fromCompact =
    isoDateToCompact(searchParams.get("from")) ??
    (defaults?.fromCompact && /^\d{8}$/.test(defaults.fromCompact)
      ? defaults.fromCompact
      : null);
  const toCompact =
    isoDateToCompact(searchParams.get("to")) ??
    (defaults?.toCompact && /^\d{8}$/.test(defaults.toCompact)
      ? defaults.toCompact
      : null);

  if (!fromCompact || !toCompact) {
    return { error: "Parametros from/to requeridos (YYYY-MM-DD)." };
  }
  if (fromCompact > toCompact) {
    return { error: "El rango de fechas es invalido." };
  }

  return {
    fromCompact,
    toCompact,
    fechas: parseList(searchParams.get("fecha")).filter((value) => /^\d{8}$/.test(value)),
    empresas: parseList(searchParams.get("empresa")).map(canonicalizeEmpresaKey),
    sedes: parseList(searchParams.get("sede")),
    categorias: parseList(searchParams.get("categoria")),
    lineas: parseList(searchParams.get("linea")),
    sublineas: parseList(searchParams.get("sublinea")),
    items: parseList(searchParams.get("item")),
    orderBy: searchParams.get("orderBy") ?? undefined,
    orderDir: searchParams.get("orderDir") === "asc" ? "asc" : searchParams.get("orderDir") === "desc" ? "desc" : undefined,
  };
};

export const buildMargenWhereClause = (
  filters: MargenQueryFilters,
  params: unknown[],
): string => {
  const parts = ["fecha_dcto IS NOT NULL"];

  if (filters.fechas.length > 0) {
    params.push(filters.fechas);
    parts.push(`fecha_dcto = ANY($${params.length}::text[])`);
  } else {
    params.push(filters.fromCompact, filters.toCompact);
    parts.push(`fecha_dcto BETWEEN $${params.length - 1} AND $${params.length}`);
  }

  if (filters.empresas.length > 0) {
    params.push(filters.empresas);
    parts.push(
      `LOWER(TRIM(COALESCE(empresa, ''))) = ANY($${params.length}::text[])`,
    );
  }

  if (filters.sedes.length > 0) {
    const sedePairs = filters.sedes
      .map(parseSedeKey)
      .filter((pair): pair is { empresa: string; idCo: string } => pair !== null);
    if (sedePairs.length > 0) {
      const empresaList = sedePairs.map((pair) => pair.empresa);
      const coList = sedePairs.map((pair) => pair.idCo);
      params.push(empresaList, coList);
      parts.push(
        `(LOWER(TRIM(COALESCE(empresa, ''))), LPAD(TRIM(COALESCE(id_co, '')), 3, '0')) IN (
          SELECT * FROM UNNEST($${params.length - 1}::text[], $${params.length}::text[]) AS t(empresa, id_co)
        )`,
      );
    }
  }

  if (filters.categorias.length > 0) {
    params.push(filters.categorias);
    parts.push(`TRIM(COALESCE(id_tipo::text, '')) = ANY($${params.length}::text[])`);
  }

  if (filters.lineas.length > 0) {
    params.push(filters.lineas);
    parts.push(`TRIM(COALESCE(id_linea1::text, '')) = ANY($${params.length}::text[])`);
  }

  if (filters.sublineas.length > 0) {
    params.push(filters.sublineas);
    parts.push(`TRIM(COALESCE(id_linea2::text, '')) = ANY($${params.length}::text[])`);
  }

  if (filters.items.length > 0) {
    params.push(filters.items);
    parts.push(`TRIM(COALESCE(id_item::text, '')) = ANY($${params.length}::text[])`);
  }

  return parts.join(" AND ");
};

export const margenMetricSelect = `
  COALESCE(SUM(COALESCE(vlrtot_bru, 0)), 0) AS ventas_netas,
  COALESCE(SUM(COALESCE(tot_costo, 0)), 0) AS costo_total,
  COALESCE(SUM(COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0)), 0) AS margen_pesos
`;

export const toMargenPct = (ventasNetas: number, margenPesos: number): number =>
  ventasNetas > 0 ? (margenPesos / ventasNetas) * 100 : 0;
