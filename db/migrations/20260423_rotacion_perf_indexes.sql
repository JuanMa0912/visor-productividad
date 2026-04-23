-- Performance indexes for Rotacion queries (catalog + rows).
-- Focus: filters by fecha_consulta + empresa + sede and item existence.

CREATE INDEX IF NOT EXISTS rotacion_base_idx_fecha
ON rotacion_base_item_dia_sede (fecha_consulta);

CREATE INDEX IF NOT EXISTS rotacion_base_idx_empresa_sede_fecha
ON rotacion_base_item_dia_sede (
  COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa'),
  COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede'),
  fecha_consulta
);

CREATE INDEX IF NOT EXISTS rotacion_base_idx_sede_fecha
ON rotacion_base_item_dia_sede (
  COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede'),
  fecha_consulta
);

CREATE INDEX IF NOT EXISTS rotacion_base_idx_fecha_empresa_sede_item
ON rotacion_base_item_dia_sede (
  fecha_consulta,
  COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa'),
  COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede'),
  COALESCE(NULLIF(TRIM(item), ''), 'sin_item')
);

CREATE INDEX IF NOT EXISTS rotacion_base_idx_linea_n1
ON rotacion_base_item_dia_sede (
  COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), '__sin_n1__')
);

CREATE INDEX IF NOT EXISTS rotacion_base_idx_categoria_key
ON rotacion_base_item_dia_sede (
  (
    CASE
      WHEN NULLIF(TRIM(categoria::text), '') IS NULL THEN '__sin_cat__'
      ELSE TRIM(BOTH FROM categoria::text)
    END
  )
);
