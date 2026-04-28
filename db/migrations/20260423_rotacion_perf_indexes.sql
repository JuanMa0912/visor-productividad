-- Legacy performance indexes for the previous rotacion_base_item_dia_sede shape.
-- Guarded so running migrations against the current fecha_dia/id_item schema does
-- not fail on columns that no longer exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'rotacion_base_item_dia_sede'
      AND column_name = 'fecha_consulta'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS rotacion_base_idx_fecha
      ON rotacion_base_item_dia_sede (fecha_consulta)
    $idx$;

    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS rotacion_base_idx_empresa_sede_fecha
      ON rotacion_base_item_dia_sede (
        COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa'),
        COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede'),
        fecha_consulta
      )
    $idx$;

    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS rotacion_base_idx_sede_fecha
      ON rotacion_base_item_dia_sede (
        COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede'),
        fecha_consulta
      )
    $idx$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'rotacion_base_item_dia_sede'
      AND column_name = 'fecha_consulta'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'rotacion_base_item_dia_sede'
      AND column_name = 'item'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS rotacion_base_idx_fecha_empresa_sede_item
      ON rotacion_base_item_dia_sede (
        fecha_consulta,
        COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa'),
        COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede'),
        COALESCE(NULLIF(TRIM(item), ''), 'sin_item')
      )
    $idx$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'rotacion_base_item_dia_sede'
      AND column_name = 'linea_n1_codigo'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS rotacion_base_idx_linea_n1
      ON rotacion_base_item_dia_sede (
        COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), '__sin_n1__')
      )
    $idx$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'rotacion_base_item_dia_sede'
      AND column_name = 'categoria'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS rotacion_base_idx_categoria_key
      ON rotacion_base_item_dia_sede (
        (
          CASE
            WHEN NULLIF(TRIM(categoria::text), '') IS NULL THEN '__sin_cat__'
            ELSE TRIM(BOTH FROM categoria::text)
          END
        )
      )
    $idx$;
  END IF;
END $$;
