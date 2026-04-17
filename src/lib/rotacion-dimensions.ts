/** Separador entre codigo de categoria y codigo de linea01 (mismo valor en otra categoria es otro item). */
export const ROTACION_CAT_LINE_SEP = "\u001f";

export const normalizeRotationCategoriaKey = (
  raw: string | null | undefined,
): string => {
  const t = String(raw ?? "").trim();
  if (!t) return "__sin_cat__";
  return t;
};

export const normalizeRotationLinea01Key = (
  raw: string | null | undefined,
): string => {
  const t = String(raw ?? "").trim();
  if (!t) return "__sin_l01__";
  if (/^\d+$/.test(t)) return t.padStart(2, "0");
  return t;
};

export const buildRotationCategoriaLineaPairKey = (
  categoriaKey: string,
  linea01Key: string,
): string =>
  `${categoriaKey}${ROTACION_CAT_LINE_SEP}${linea01Key}`;

export const parseRotationCategoriaLineaPairKey = (
  key: string,
): { categoriaKey: string; linea01Key: string } | null => {
  const i = key.indexOf(ROTACION_CAT_LINE_SEP);
  if (i <= 0) return null;
  return { categoriaKey: key.slice(0, i), linea01Key: key.slice(i + 1) };
};
