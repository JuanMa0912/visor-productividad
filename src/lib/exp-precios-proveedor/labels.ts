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
 * Entrada REAL de inventario (POS `cmmovimiento_inventario`): solo EF.
 *
 * El transito (ET) NO entra aqui aunque sea del mismo maestro: es mercancia que
 * viene en camino y todavia no se recibio, asi que sumarla al recibido mezcla
 * dos cosas distintas e infla kilos, costo y margen. Antes se sumaba en
 * Mercatodo; ahora el transito se reporta aparte en las tres empresas.
 * Ver transitoTipdocSql.
 */
export const ocEntradaInvTipdocSql = (
  _empresaExpr: string,
  tipdocExpr: string,
): string => `
(UPPER(BTRIM(${tipdocExpr})) = 'EF')
`;

/** Transito: mercancia despachada y no recibida. Se informa, nunca se suma. */
export const transitoTipdocSql = (tipdocExpr: string): string => `
(UPPER(BTRIM(${tipdocExpr})) = 'ET')
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
  ${transitoTipdocSql(tipdocExpr)}
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
