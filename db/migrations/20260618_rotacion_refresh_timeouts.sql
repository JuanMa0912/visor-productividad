-- Sin limite de statement_timeout en el refresh del snapshot periodo std
-- (agregacion pesada sobre ~6M filas diarias filtradas por rango).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'refresh_rotacion_item_periodo_std'
  ) THEN
    EXECUTE 'ALTER FUNCTION refresh_rotacion_item_periodo_std() SET statement_timeout = 0';
    RAISE NOTICE 'refresh_rotacion_item_periodo_std: statement_timeout=0';
  END IF;
END $$;
