-- Performance indexes for the current rotacion_base_item_dia_sede shape.
-- These mirror the /api/rotacion and /api/inventario-x-item filters after the
-- table switched to id_item, id_linea_nivel_1, id_categoria and fecha_dia.

CREATE INDEX IF NOT EXISTS rotacion_base_new_idx_fecha_dia
ON rotacion_base_item_dia_sede (fecha_dia);

CREATE INDEX IF NOT EXISTS rotacion_base_new_idx_empresa_sede_fecha
ON rotacion_base_item_dia_sede (
  COALESCE(NULLIF(TRIM(empresa::text), ''), 'sin_empresa'),
  COALESCE(NULLIF(TRIM(sede::text), ''), 'sin_sede'),
  fecha_dia
);

CREATE INDEX IF NOT EXISTS rotacion_base_new_idx_sede_fecha
ON rotacion_base_item_dia_sede (
  COALESCE(NULLIF(TRIM(sede::text), ''), 'sin_sede'),
  fecha_dia
);

CREATE INDEX IF NOT EXISTS rotacion_base_new_idx_fecha_empresa_sede_item
ON rotacion_base_item_dia_sede (
  fecha_dia,
  COALESCE(NULLIF(TRIM(empresa::text), ''), 'sin_empresa'),
  COALESCE(NULLIF(TRIM(sede::text), ''), 'sin_sede'),
  COALESCE(NULLIF(TRIM(id_item::text), ''), 'sin_item')
)
WHERE NULLIF(TRIM(id_item::text), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS rotacion_base_new_idx_linea_n1
ON rotacion_base_item_dia_sede (
  (
    CASE
      WHEN NULLIF(TRIM(id_linea_nivel_1::text), '') IS NULL THEN '__sin_n1__'
      WHEN NULLIF(TRIM(id_linea_nivel_1::text), '') ~ '^[0-9]+$'
        THEN LPAD(NULLIF(TRIM(id_linea_nivel_1::text), ''), 2, '0')
      ELSE NULLIF(TRIM(id_linea_nivel_1::text), '')
    END
  )
);

CREATE INDEX IF NOT EXISTS rotacion_base_new_idx_categoria_key
ON rotacion_base_item_dia_sede (
  (
    CASE
      WHEN NULLIF(TRIM(id_categoria::text), '') IS NULL THEN '__sin_cat__'
      ELSE TRIM(BOTH FROM id_categoria::text)
    END
  )
);
