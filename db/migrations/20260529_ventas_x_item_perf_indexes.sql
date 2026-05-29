-- Indices de performance para /api/ventas-x-item (y v2).
--
-- Las queries de la app (route.ts y v2/route.ts) filtran asi:
--   WHERE fecha_dcto BETWEEN $1 AND $2
--     AND COALESCE(NULLIF(empresa_norm, ''), empresa) = ANY($3)
-- y agrupan por (empresa, fecha_dcto, id_co, id_item) en mode=summary.
--
-- El indice existente `ventas_item_diario_idx_empresa` esta sobre
--   COALESCE(empresa_norm, empresa)
-- (SIN el NULLIF), por lo que Postgres NO lo aprovecha contra el WHERE
-- de la app y termina haciendo seq scan + sort, llegando a tomar varios minutos
-- con cientos de miles de filas.
--
-- Estos indices coinciden EXACTO con las expresiones que ya usa el codigo,
-- por lo que el planner los selecciona sin tocar el SQL del backend.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ventas_item_diario'
  ) THEN

    -- (fecha_dcto, empresa_norm) para el filtro principal: rango de fechas + empresa.
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS ventas_item_diario_idx_fecha_empresa_expr
      ON ventas_item_diario (
        fecha_dcto,
        (COALESCE(NULLIF(empresa_norm, ''), empresa))
      )
    $idx$;

    -- Indice de soporte para mode=summary (GROUP BY empresa, fecha, id_co, id_item).
    -- Permite hacer index scan + aggregation sin pasar por la tabla en muchos casos.
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS ventas_item_diario_idx_summary
      ON ventas_item_diario (
        fecha_dcto,
        (COALESCE(NULLIF(empresa_norm, ''), empresa)),
        id_co,
        id_item
      )
    $idx$;

    -- Indice equivalente para id_co normalizado, usado por v2/route.ts cuando
    -- llega el parametro idCo (filtro adicional al de empresa + fecha).
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS ventas_item_diario_idx_fecha_empresa_idco_expr
      ON ventas_item_diario (
        fecha_dcto,
        (COALESCE(NULLIF(empresa_norm, ''), empresa)),
        (COALESCE(NULLIF(id_co_norm, ''), id_co))
      )
    $idx$;

  END IF;
END $$;

ANALYZE ventas_item_diario;
