/**
 * Quita prefijos de empresa (Mercamio / Mercatodo / Bogotá / Merkmios) del
 * nombre de proveedor. En Costos el origen no importa: el nombre visible es
 * solo el tercero.
 */
const EMPRESA_PROVEEDOR_PREFIX =
  /^(mercamio|mercamios|mercatodo|mtodo|merkmios|bogota|bogotá)\b[\s\-–:_]*/i;

export const stripEmpresaProveedorLabel = (label: string): string => {
  let raw = String(label ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i += 1) {
    const stripped = raw.replace(EMPRESA_PROVEEDOR_PREFIX, "").trim();
    if (!stripped || stripped === raw) break;
    raw = stripped;
  }
  return raw;
};

/** Alias histórico: el strip cubre todas las empresas, no solo Mercamio. */
export const stripMercamioProveedorLabel = stripEmpresaProveedorLabel;

export const proveedorExpandGroupKey = (itemId: string, label: string): string =>
  `${itemId}::${stripEmpresaProveedorLabel(label).toLocaleLowerCase("es")}`;

export const isComercializadoraEmpresa = (empresa: string): boolean => {
  const key = String(empresa ?? "")
    .trim()
    .toLowerCase();
  return key === "mtodo" || key === "mercatodo";
};

/**
 * Entrada real de inventario (POS `cmmovimiento_inventario`).
 * EF = entrada de factura (fruver). ET = tránsito (Mercatodo).
 */
export const ocEntradaInvTipdocSql = (
  empresaExpr: string,
  tipdocExpr: string,
): string => `
(
  (
    LOWER(BTRIM(${empresaExpr})) IN ('mtodo', 'mercatodo')
    AND UPPER(BTRIM(${tipdocExpr})) IN ('ET', 'EF')
  )
  OR (
    LOWER(BTRIM(${empresaExpr})) NOT IN ('mtodo', 'mercatodo')
    AND UPPER(BTRIM(${tipdocExpr})) = 'EF'
  )
)
`;

/** Pedido/recibo en `cmmovimiento_ocompra` (FR/OC/OM/OS). Fallback si no hay ET/EF. */
export const ocEntradaPoTipdocSql = (
  empresaExpr: string,
  tipdocExpr: string,
): string => `
(
  (
    LOWER(BTRIM(${empresaExpr})) IN ('mtodo', 'mercatodo')
    AND UPPER(BTRIM(${tipdocExpr})) = 'FR'
  )
  OR (
    LOWER(BTRIM(${empresaExpr})) NOT IN ('mtodo', 'mercatodo')
    AND UPPER(BTRIM(${tipdocExpr})) IN ('FR', 'OC', 'OM', 'OS')
  )
)
`;

/**
 * Documentos de entrada para el tablero Costos.
 * Inventario ET/EF (217 `cmmovimiento_inventario`) + OC FR/OC/OM/OS.
 * El costo prefiere ET/EF sobre el pedido para no duplicar FR+EF.
 */
export const ocEntradaTipdocSql = (
  empresaExpr: string,
  tipdocExpr: string,
): string => `
(
  ${ocEntradaInvTipdocSql(empresaExpr, tipdocExpr)}
  OR
  ${ocEntradaPoTipdocSql(empresaExpr, tipdocExpr)}
)
`;

/**
 * Kilos de entrada efectiva: `cantidad_ent` (recibido).
 * ET (solo tránsito Mercatodo) usa `cantidad` porque aún no hay recibo.
 */
export const ocEntradaQtySql = (tipdocExpr: string): string => `
CASE
  WHEN UPPER(BTRIM(${tipdocExpr})) = 'ET'
    THEN COALESCE(cantidad, 0)
  ELSE COALESCE(cantidad_ent, 0)
END
`;
