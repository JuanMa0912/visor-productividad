-- ============================================================================
-- Dinastia: rollup factura+item para /margenes (paridad con margen_final_roll)
-- ============================================================================
-- Fuente: margen_dinastia
-- Objeto: margen_dinastia_roll + refresh_margen_dinastia_roll(p_from, p_to)
--
-- Incluye attrs de factura (cliente/caja/vendedor/docfc) desde el dia 1.
-- fecha_dcto se normaliza a YYYYMMDD (acepta ISO o compacto en origen).
--
-- Poblar:
--   SELECT * FROM refresh_margen_dinastia_roll();
--   -- o incremental: SELECT * FROM refresh_margen_dinastia_roll('20260701','20260723');
--   -- o: npm run margen:refresh-roll  (tambien refresca Dinastia si existe)
-- ============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS margen_dinastia_roll (
  fecha_dcto TEXT NOT NULL,
  empresa_norm TEXT NOT NULL,
  id_co_norm TEXT NOT NULL,
  id_tipo TEXT NOT NULL DEFAULT '',
  id_linea1 TEXT NOT NULL DEFAULT '',
  id_linea2 TEXT NOT NULL DEFAULT '',
  id_item TEXT NOT NULL DEFAULT '',
  documento_fc TEXT NOT NULL DEFAULT '',
  id_tipdoc_fc TEXT NOT NULL DEFAULT '',
  nombre_linea1 TEXT,
  nombre_linea2 TEXT,
  item_descripcion TEXT,
  documento_docfc TEXT,
  id_terc TEXT,
  nombre_terc TEXT,
  id_caja TEXT,
  vend_cc TEXT,
  vend_cc_desc TEXT,
  ventas_netas NUMERIC(18, 4) NOT NULL DEFAULT 0,
  costo_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  margen_pesos NUMERIC(18, 4) NOT NULL DEFAULT 0,
  cantidad NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ventas_con_iva NUMERIC(18, 4) NOT NULL DEFAULT 0,
  CONSTRAINT margen_dinastia_roll_pk PRIMARY KEY (
    fecha_dcto,
    empresa_norm,
    id_co_norm,
    id_tipo,
    id_linea1,
    id_linea2,
    id_item,
    documento_fc,
    id_tipdoc_fc
  )
);

COMMENT ON TABLE margen_dinastia_roll IS
  'Agregado factura+item/dia/sede desde margen_dinastia; alimenta /margenes tenant Dinastia.';

CREATE INDEX IF NOT EXISTS margen_dinastia_roll_idx_sede_fecha
  ON margen_dinastia_roll (empresa_norm, id_co_norm, fecha_dcto);

CREATE INDEX IF NOT EXISTS margen_dinastia_roll_idx_fecha_sede
  ON margen_dinastia_roll (fecha_dcto, empresa_norm, id_co_norm);

CREATE INDEX IF NOT EXISTS margen_dinastia_roll_idx_sede_fecha_tipo
  ON margen_dinastia_roll (empresa_norm, id_co_norm, fecha_dcto, id_tipo);

-- Dinastia usa id_tipo=1 (no Mercado/4).
CREATE INDEX IF NOT EXISTS margen_dinastia_roll_idx_sede_fecha_tipo1
  ON margen_dinastia_roll (empresa_norm, id_co_norm, fecha_dcto)
  WHERE id_tipo = '1';

CREATE INDEX IF NOT EXISTS margen_dinastia_roll_idx_terc_fecha
  ON margen_dinastia_roll (id_terc, fecha_dcto);

CREATE INDEX IF NOT EXISTS margen_dinastia_roll_idx_fecha_terc
  ON margen_dinastia_roll (fecha_dcto, id_terc);

CREATE INDEX IF NOT EXISTS margen_dinastia_roll_idx_documento
  ON margen_dinastia_roll (
    documento_fc,
    id_tipdoc_fc,
    empresa_norm,
    id_co_norm,
    fecha_dcto
  );

CREATE OR REPLACE FUNCTION refresh_margen_dinastia_roll(
  p_from TEXT DEFAULT NULL,
  p_to TEXT DEFAULT NULL
)
RETURNS TABLE (inserted_rows BIGINT, elapsed_ms BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  t0 TIMESTAMPTZ := clock_timestamp();
  n BIGINT;
  v_from TEXT;
  v_to TEXT;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM set_config('work_mem', '256MB', true);

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'margen_dinastia'
  ) THEN
    RAISE EXCEPTION 'margen_dinastia no existe; aplica 20260723_dinastia_tenant_tables.sql primero';
  END IF;

  IF p_from IS NULL AND p_to IS NULL THEN
    TRUNCATE margen_dinastia_roll;
    v_from := '00000000';
    v_to := '99999999';
  ELSE
    v_from := COALESCE(p_from, '00000000');
    v_to := COALESCE(p_to, '99999999');
    DELETE FROM margen_dinastia_roll
    WHERE fecha_dcto >= v_from
      AND fecha_dcto <= v_to;
  END IF;

  INSERT INTO margen_dinastia_roll (
    fecha_dcto,
    empresa_norm,
    id_co_norm,
    id_tipo,
    id_linea1,
    id_linea2,
    id_item,
    documento_fc,
    id_tipdoc_fc,
    nombre_linea1,
    nombre_linea2,
    item_descripcion,
    documento_docfc,
    id_terc,
    nombre_terc,
    id_caja,
    vend_cc,
    vend_cc_desc,
    ventas_netas,
    costo_total,
    margen_pesos,
    cantidad,
    ventas_con_iva
  )
  SELECT
    regexp_replace(left(fecha_dcto::text, 10), '[^0-9]', '', 'g') AS fecha_dcto,
    lower(trim(COALESCE(empresa, ''))) AS empresa_norm,
    lpad(trim(COALESCE(id_co, '')), 3, '0') AS id_co_norm,
    trim(COALESCE(id_tipo::text, '')) AS id_tipo,
    trim(COALESCE(id_linea1::text, '')) AS id_linea1,
    trim(COALESCE(id_linea2::text, '')) AS id_linea2,
    trim(COALESCE(id_item::text, '')) AS id_item,
    trim(COALESCE(documento_fc::text, '')) AS documento_fc,
    trim(COALESCE(id_tipdoc_fc::text, '')) AS id_tipdoc_fc,
    MAX(NULLIF(trim(nombre_linea1), '')) AS nombre_linea1,
    MAX(NULLIF(trim(nombre_linea2), '')) AS nombre_linea2,
    MAX(NULLIF(trim(item_descripcion), '')) AS item_descripcion,
    MAX(NULLIF(trim(documento_docfc), '')) AS documento_docfc,
    MAX(NULLIF(trim(id_terc), '')) AS id_terc,
    MAX(NULLIF(trim(nombre_terc), '')) AS nombre_terc,
    MAX(NULLIF(trim(id_caja), '')) AS id_caja,
    MAX(NULLIF(trim(vend_cc), '')) AS vend_cc,
    MAX(NULLIF(trim(vend_cc_desc), '')) AS vend_cc_desc,
    COALESCE(SUM(COALESCE(vlrtot_bru, 0)), 0),
    COALESCE(SUM(COALESCE(tot_costo, 0)), 0),
    COALESCE(SUM(COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0)), 0),
    COALESCE(SUM(COALESCE(cantidad, 0)), 0),
    COALESCE(SUM(COALESCE(ven_totales, 0)), 0)
  FROM margen_dinastia
  WHERE fecha_dcto IS NOT NULL
    AND regexp_replace(left(fecha_dcto::text, 10), '[^0-9]', '', 'g') ~ '^[0-9]{8}$'
    AND regexp_replace(left(fecha_dcto::text, 10), '[^0-9]', '', 'g') >= v_from
    AND regexp_replace(left(fecha_dcto::text, 10), '[^0-9]', '', 'g') <= v_to
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9;

  GET DIAGNOSTICS n = ROW_COUNT;

  IF p_from IS NULL AND p_to IS NULL THEN
    ANALYZE margen_dinastia_roll;
  END IF;

  RETURN QUERY
  SELECT
    n,
    (EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::BIGINT;
END;
$$;

COMMENT ON FUNCTION refresh_margen_dinastia_roll(TEXT, TEXT) IS
  'Pobla margen_dinastia_roll (factura+item). Sin args: full. Con p_from/p_to: rango YYYYMMDD. Normaliza fecha ISO→compacto.';
