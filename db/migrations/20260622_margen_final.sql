-- Tabla nueva para el tablero de margen unificado (detalle linea + factura).
-- Nombre de negocio: margenFinal. En PostgreSQL: margen_final.
--
-- Esquema alineado al CSV de origen (ej. movimiento_unificado_*_mtodo_003.csv).
-- fecha_dcto en formato YYYYMMDD (texto, igual que ventas_*).
--
-- Legacy margenes_linea_co_dia se conserva hasta validar ETL del nuevo tablero.

CREATE TABLE IF NOT EXISTS margen_final (
  id BIGSERIAL PRIMARY KEY,
  empresa TEXT,
  id_empresa TEXT,
  fecha_dcto TEXT,
  id_co TEXT,
  id_caja TEXT,
  hora_final TEXT,
  id_item TEXT,
  item_descripcion TEXT,
  id_tipo TEXT,
  id_linea1 TEXT,
  nombre_linea1 TEXT,
  id_linea2 TEXT,
  nombre_linea2 TEXT,
  id_linea TEXT,
  nombre_linea TEXT,
  id_unidad TEXT,
  cantidad NUMERIC(18, 4),
  precio_uni NUMERIC(18, 4),
  dscto_netos NUMERIC(18, 4),
  vlrtot_bru NUMERIC(18, 4),
  vlrimpcon1 NUMERIC(18, 4),
  ven_totales NUMERIC(18, 4),
  precio_unitario NUMERIC(18, 4),
  tot_costo NUMERIC(18, 4),
  costo_unitario NUMERIC(18, 4),
  documento_fc TEXT,
  id_tipdoc_fc TEXT,
  vend_cc TEXT,
  vend_cc_desc TEXT,
  CONSTRAINT margen_final_fecha_dcto_fmt CHECK (
    fecha_dcto IS NULL OR fecha_dcto ~ '^[0-9]{8}$'
  )
);

COMMENT ON TABLE margen_final IS
  'Margen/movimiento unificado por linea de venta y factura (CSV movimiento_unificado).';

COMMENT ON COLUMN margen_final.fecha_dcto IS 'YYYYMMDD';
COMMENT ON COLUMN margen_final.id_co IS 'Centro de operacion / sede (ej. 003).';
COMMENT ON COLUMN margen_final.id_tipo IS 'Categoria/tipo (ej. 4=MERCADO en reglas del tablero).';
COMMENT ON COLUMN margen_final.id_caja IS 'Caja/punto de venta dentro de la sede.';

CREATE INDEX IF NOT EXISTS margen_final_idx_fecha_empresa_co
  ON margen_final (fecha_dcto DESC, empresa, id_co);

CREATE INDEX IF NOT EXISTS margen_final_idx_documento
  ON margen_final (documento_fc, id_tipdoc_fc);

CREATE INDEX IF NOT EXISTS margen_final_idx_item_fecha
  ON margen_final (id_item, fecha_dcto DESC);

CREATE INDEX IF NOT EXISTS margen_final_idx_lineas_fecha
  ON margen_final (id_linea1, id_linea2, id_linea, fecha_dcto DESC);
