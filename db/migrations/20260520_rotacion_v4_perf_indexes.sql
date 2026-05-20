-- Indices funcionales para rotacion_v4 alineados con las expresiones normalizadas
-- usadas en /api/rotacion (rotacion-dos). Sin estos indices la planificacion
-- elige seq scan porque las expresiones del WHERE no coinciden con los indices
-- crudos existentes (empresa, sede, id_linea_nivel_1), provocando consultas de
-- varios minutos en tablas con cientos de miles de filas.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'rotacion_v4'
  ) THEN

    -- (empresa_normalizada, fecha_dia) para filtros por empresa + rango de fechas.
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS rotacion_v4_idx_empresa_norm_fecha
      ON rotacion_v4 (
        (COALESCE(NULLIF(TRIM(empresa::text), ''), 'sin_empresa')),
        fecha_dia
      )
    $idx$;

    -- (sede_normalizada, fecha_dia) para filtros por sede + rango.
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS rotacion_v4_idx_sede_norm_fecha
      ON rotacion_v4 (
        (COALESCE(NULLIF(TRIM(sede::text), ''), 'sin_sede')),
        fecha_dia
      )
    $idx$;

    -- Compuesto (fecha_dia, empresa_norm, sede_norm) para consultas que ya tienen
    -- el rango de fechas como filtro principal y luego acotan por empresa + sede.
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS rotacion_v4_idx_fecha_empresa_norm_sede_norm
      ON rotacion_v4 (
        fecha_dia,
        (COALESCE(NULLIF(TRIM(empresa::text), ''), 'sin_empresa')),
        (COALESCE(NULLIF(TRIM(sede::text), ''), 'sin_sede'))
      )
    $idx$;

    -- Linea N1 con normalizacion (LPAD a 2 digitos) + fecha_dia.
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS rotacion_v4_idx_n1_norm_fecha
      ON rotacion_v4 (
        (COALESCE(
          CASE
            WHEN NULLIF(TRIM(id_linea_nivel_1::text), '') IS NULL THEN NULL::text
            WHEN NULLIF(TRIM(id_linea_nivel_1::text), '') ~ '^[0-9]+$' THEN LPAD(NULLIF(TRIM(id_linea_nivel_1::text), ''), 2, '0')
            ELSE NULLIF(TRIM(id_linea_nivel_1::text), '')
          END,
          '__sin_n1__'
        )),
        fecha_dia
      )
    $idx$;

    -- Categoria normalizada (id_categoria) + fecha_dia.
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS rotacion_v4_idx_categoria_norm_fecha
      ON rotacion_v4 (
        (
          CASE
            WHEN NULLIF(TRIM(id_categoria::text), '') IS NULL THEN '__sin_cat__'
            ELSE TRIM(BOTH FROM id_categoria::text)
          END
        ),
        fecha_dia
      )
    $idx$;

  END IF;
END $$;

ANALYZE rotacion_v4;
