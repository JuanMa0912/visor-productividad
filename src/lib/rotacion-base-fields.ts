export const ROTACION_BASE_ITEM_DIA_SEDE_TABLE =
  "rotacion_base_item_dia_sede";

export type RotacionBaseDateColumn =
  | "fecha_dia"
  | "fecha_consulta"
  | "fecha"
  | "fecha_carga";

export type RotacionBaseQueryClient = {
  query: (
    queryText: string,
    values?: unknown[],
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>;
};

export type RotacionBaseSqlFields = {
  dateColumn: RotacionBaseDateColumn;
  empresaExpr: string;
  sedeIdExpr: string;
  sedeNameExpr: string;
  lineExpr: string;
  lineNullableExpr: string;
  n1CodeExpr: string;
  itemExpr: string;
  itemNullableExpr: string;
  itemPresentCondition: string;
  descriptionExpr: string;
  unitExpr: string;
  salesExpr: string;
  marginExpr: string;
  unitsSoldExpr: string;
  closingUnitsExpr: string;
  inventoryValueExpr: string;
  lastSaleDateExpr: string;
  lastEntryDateExpr: string;
  bodegaExpr: string;
  nombreBodegaExpr: string;
  categoriaExpr: string;
  categoriaNameExpr: string;
  linea01Expr: string;
  nombreLinea01Expr: string;
  loadTimestampExpr: string;
  categoriaKeyExpr: string;
  allowedCategoriaExpr: string;
};

type ColumnMeta = {
  dataType: string;
};

const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

let rotacionBaseColumnsCache:
  | { value: Map<string, ColumnMeta>; expiresAt: number }
  | null = null;

const NUMERIC_DATA_TYPES = new Set([
  "bigint",
  "decimal",
  "double precision",
  "integer",
  "numeric",
  "real",
  "smallint",
]);

const DATE_DATA_TYPES = new Set(["date"]);

const TIMESTAMP_DATA_TYPE_FRAGMENTS = ["timestamp"];

const sqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

const normalizeColumnRows = (
  rows: Array<Record<string, unknown>>,
): Map<string, ColumnMeta> => {
  const columns = new Map<string, ColumnMeta>();
  for (const row of rows) {
    const name = String(row.column_name ?? "").trim();
    if (!name || columns.has(name)) continue;
    columns.set(name, {
      dataType: String(row.data_type ?? "").trim().toLowerCase(),
    });
  }
  return columns;
};

export const getRotacionBaseColumns = async (
  client: RotacionBaseQueryClient,
): Promise<Map<string, ColumnMeta>> => {
  const now = Date.now();
  if (rotacionBaseColumnsCache && rotacionBaseColumnsCache.expiresAt > now) {
    return rotacionBaseColumnsCache.value;
  }

  const scopedResult = await client.query(
    `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = $1
      AND table_schema = ANY(current_schemas(false))
    ORDER BY ordinal_position
    `,
    [ROTACION_BASE_ITEM_DIA_SEDE_TABLE],
  );
  let columns = normalizeColumnRows(scopedResult.rows ?? []);

  if (columns.size === 0) {
    const fallbackResult = await client.query(
      `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
      `,
      [ROTACION_BASE_ITEM_DIA_SEDE_TABLE],
    );
    columns = normalizeColumnRows(fallbackResult.rows ?? []);
  }

  rotacionBaseColumnsCache = {
    value: columns,
    expiresAt: now + SCHEMA_CACHE_TTL_MS,
  };
  return columns;
};

const pickColumn = (
  columns: Map<string, ColumnMeta>,
  candidates: string[],
): string | null => candidates.find((candidate) => columns.has(candidate)) ?? null;

const nullableTextColumnExpr = (column: string | null) =>
  column ? `NULLIF(TRIM(${column}::text), '')` : "NULL::text";

const nullableTextExpr = (
  columns: Map<string, ColumnMeta>,
  candidates: string[],
) => nullableTextColumnExpr(pickColumn(columns, candidates));

const coalesceTextExpr = (
  columns: Map<string, ColumnMeta>,
  candidates: string[],
  fallback: string,
) => {
  const exprs = candidates
    .filter((candidate) => columns.has(candidate))
    .map((candidate) => nullableTextColumnExpr(candidate));
  return `COALESCE(${[...exprs, sqlLiteral(fallback)].join(", ")})`;
};

const numericColumnExpr = (
  columns: Map<string, ColumnMeta>,
  column: string | null,
) => {
  if (!column) return "0::numeric";
  const dataType = columns.get(column)?.dataType ?? "";
  if (NUMERIC_DATA_TYPES.has(dataType)) {
    return `COALESCE(${column}, 0)::numeric`;
  }

  const raw = `NULLIF(REPLACE(TRIM(${column}::text), ',', '.'), '')`;
  return `COALESCE(CASE WHEN ${raw} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${raw}::numeric ELSE NULL END, 0::numeric)`;
};

const numericExpr = (
  columns: Map<string, ColumnMeta>,
  candidates: string[],
) => numericColumnExpr(columns, pickColumn(columns, candidates));

const dateColumnExpr = (
  columns: Map<string, ColumnMeta>,
  column: string | null,
) => {
  if (!column) return "NULL::date";
  const dataType = columns.get(column)?.dataType ?? "";
  if (DATE_DATA_TYPES.has(dataType) || TIMESTAMP_DATA_TYPE_FRAGMENTS.some((t) => dataType.includes(t))) {
    return `${column}::date`;
  }

  const raw = `NULLIF(TRIM(${column}::text), '')`;
  return `CASE
    WHEN ${raw} IS NULL THEN NULL::date
    WHEN ${raw} ~ '^[0-9]{8}$' THEN TO_DATE(${raw}, 'YYYYMMDD')
    WHEN ${raw} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN LEFT(${raw}, 10)::date
    ELSE NULL::date
  END`;
};

const coalesceDateExpr = (
  columns: Map<string, ColumnMeta>,
  candidates: string[],
) => {
  const exprs = candidates
    .filter((candidate) => columns.has(candidate))
    .map((candidate) => dateColumnExpr(columns, candidate));
  return exprs.length > 0 ? `COALESCE(${exprs.join(", ")})` : "NULL::date";
};

const timestampColumnExpr = (
  columns: Map<string, ColumnMeta>,
  column: string | null,
) => {
  if (!column) return "NULL::timestamp";
  const dataType = columns.get(column)?.dataType ?? "";
  if (TIMESTAMP_DATA_TYPE_FRAGMENTS.some((t) => dataType.includes(t))) {
    return `${column}::timestamp`;
  }
  if (DATE_DATA_TYPES.has(dataType)) {
    return `${column}::timestamp`;
  }

  const raw = `NULLIF(TRIM(${column}::text), '')`;
  return `CASE
    WHEN ${raw} IS NULL THEN NULL::timestamp
    WHEN ${raw} ~ '^[0-9]{8}$' THEN TO_DATE(${raw}, 'YYYYMMDD')::timestamp
    WHEN ${raw} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN ${raw}::timestamp
    ELSE NULL::timestamp
  END`;
};

const coalesceTimestampExpr = (
  columns: Map<string, ColumnMeta>,
  candidates: string[],
) => {
  const exprs = candidates
    .filter((candidate) => columns.has(candidate))
    .map((candidate) => timestampColumnExpr(columns, candidate));
  return exprs.length > 0
    ? `COALESCE(${exprs.join(", ")})`
    : "NULL::timestamp";
};

const normalizeTwoDigitCodeExpr = (expr: string) => `(
  CASE
    WHEN ${expr} IS NULL THEN NULL::text
    WHEN ${expr} ~ '^[0-9]+$' THEN LPAD(${expr}, 2, '0')
    ELSE ${expr}
  END
)`;

export const resolveRotacionBaseSqlFields = async (
  client: RotacionBaseQueryClient,
): Promise<RotacionBaseSqlFields> => {
  const columns = await getRotacionBaseColumns(client);
  const dateColumn = pickColumn(columns, [
    "fecha_dia",
    "fecha_consulta",
    "fecha",
    "fecha_carga",
  ]);

  if (!dateColumn) {
    throw new Error(
      "No existe una columna de fecha valida en rotacion_base_item_dia_sede (esperadas: fecha_dia, fecha_consulta, fecha o fecha_carga).",
    );
  }

  const salesExpr = numericExpr(columns, [
    "venta_sin_impuesto",
    "venta_sin_impuesto_dia",
    "venta_sin_iva",
    "venta_neta",
    "venta",
  ]);
  const unitsSoldExpr = numericExpr(columns, [
    "cantidad_vendida",
    "unidades_vendidas_dia",
    "unidades_vendidas",
    "unidades",
  ]);
  const avgUnitCostAtSaleColumn = pickColumn(columns, [
    "costo_promedio_venta",
    "costo_promedio_unitario_venta",
    "costo_promedio_unitario",
    "costo_uni_promedio",
    "costo_unitario_promedio",
    "costo_promedio",
    "costo_uni_inventario",
    "costo_unitario",
  ]);
  const avgUnitCostAtSaleExpr = numericColumnExpr(columns, avgUnitCostAtSaleColumn);
  const closingUnitsExpr = `GREATEST(${numericExpr(columns, [
    "can_disponible_foto",
    "inventario_cierre",
    "inv_cierre_dia_ayer",
    "inventario_unidades",
    "inv_cierre",
  ])}, 0)`;
  const unitCostExpr = numericExpr(columns, ["costo_uni_inventario"]);
  const inventoryValueExpr =
    columns.has("can_disponible_foto") && columns.has("costo_uni_inventario")
      ? `GREATEST((${closingUnitsExpr}) * (${unitCostExpr}), 0)`
      : `GREATEST(${numericExpr(columns, [
          "valor_inventario",
          "inventario_valor",
          "valor_inv",
        ])}, 0)`;
  const categoriaExpr = nullableTextExpr(columns, ["id_categoria", "categoria"]);
  const categoriaNameExpr = nullableTextExpr(columns, ["nombre_categoria"]);
  const n1CodeExpr = normalizeTwoDigitCodeExpr(
    nullableTextExpr(columns, [
      "id_linea_nivel_1",
      "linea_nivel_1_codigo",
      "linea_n1_codigo",
      "linea01",
    ]),
  );
  const categoriaKeyExpr = `(
    CASE
      WHEN ${categoriaExpr} IS NULL THEN '__sin_cat__'
      ELSE ${categoriaExpr}
    END
  )`;

  return {
    dateColumn: dateColumn as RotacionBaseDateColumn,
    empresaExpr: coalesceTextExpr(columns, ["empresa"], "sin_empresa"),
    sedeIdExpr: coalesceTextExpr(columns, ["sede"], "sin_sede"),
    sedeNameExpr: coalesceTextExpr(columns, ["nombre_sede", "sede"], "Sin sede"),
    lineExpr: coalesceTextExpr(
      columns,
      ["nombre_linea_nivel_1", "linea", "nombre_linea01"],
      "Sin linea",
    ),
    lineNullableExpr: nullableTextExpr(columns, [
      "nombre_linea_nivel_1",
      "linea",
      "nombre_linea01",
    ]),
    n1CodeExpr,
    itemExpr: coalesceTextExpr(columns, ["id_item", "item"], "sin_item"),
    itemNullableExpr: nullableTextExpr(columns, ["id_item", "item"]),
    itemPresentCondition: `${nullableTextExpr(columns, ["id_item", "item"])} IS NOT NULL`,
    descriptionExpr: coalesceTextExpr(
      columns,
      ["nombre_item", "descripcion", "id_item", "item"],
      "Sin descripcion",
    ),
    unitExpr: nullableTextExpr(columns, ["id_unidad", "unidad"]),
    salesExpr,
    // Margen del periodo por fila bajo regla de kardex (promedio ponderado):
    // costo total venta = unidades vendidas * costo promedio unitario vigente.
    marginExpr: avgUnitCostAtSaleColumn
      ? `ROUND(((${salesExpr}) - ((${unitsSoldExpr}) * (${avgUnitCostAtSaleExpr})))::numeric, 2)`
      : "0::numeric",
    unitsSoldExpr,
    closingUnitsExpr,
    inventoryValueExpr,
    lastSaleDateExpr: coalesceDateExpr(columns, [
      "ultima_venta_pdv",
      "ultima_venta_inventario",
      "fecha_ultima_venta",
    ]),
    lastEntryDateExpr: coalesceDateExpr(columns, [
      "fecha_ultima_entrada",
      "fecha_ultima_compra",
    ]),
    bodegaExpr: nullableTextExpr(columns, ["bodega_local", "bodega"]),
    nombreBodegaExpr: nullableTextExpr(columns, ["nombre_bodega"]),
    categoriaExpr,
    categoriaNameExpr,
    linea01Expr: n1CodeExpr,
    nombreLinea01Expr: nullableTextExpr(columns, [
      "nombre_linea_nivel_1",
      "nombre_linea01",
      "linea",
    ]),
    loadTimestampExpr: coalesceTimestampExpr(columns, [
      "fecha_actualizacion",
      "fecha_carga",
      "fecha_dia",
      "fecha_consulta",
    ]),
    categoriaKeyExpr,
    allowedCategoriaExpr: `(
      NOT (
        ${categoriaKeyExpr} = ANY(ARRAY['3', 'V']::text[])
        OR UPPER(TRIM(COALESCE(${categoriaNameExpr}, ''))) = ANY(
          ARRAY['PRODUCTO TERMINADO', 'SERVICIOS DE VENTA']::text[]
        )
      )
    )`,
  };
};
