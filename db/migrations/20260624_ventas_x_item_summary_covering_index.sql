-- Indice covering para mode=summary: evita heap fetches en SUM/MAX durante GROUP BY.
-- Complementa 20260529_ventas_x_item_perf_indexes.sql (filtro + claves de grupo).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ventas_item_diario'
  ) THEN

    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS ventas_item_diario_idx_summary_covering
      ON ventas_item_diario (
        fecha_dcto,
        (COALESCE(NULLIF(empresa_norm, ''), empresa)),
        id_co,
        id_item
      )
      INCLUDE (descripcion, linea, und_dia, venta_sin_impuesto_dia)
    $idx$;

  END IF;
END $$;

ANALYZE ventas_item_diario;
