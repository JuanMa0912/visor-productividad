-- Performance pestaña Por Vendedor + detalle de factura en /margenes.
--
-- Patrón análogo a 20260723_margen_cliente_perf_indexes.sql:
--   1) vend_cc + fecha  -> facturas de un vendedor
--   2) fecha + vend_cc  -> agregación por vendedor en ventana de fechas
--
-- En tablas grandes vivas preferir CONCURRENTLY a mano:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS ... ;

CREATE INDEX IF NOT EXISTS margen_final_roll_idx_vend_cc_fecha
  ON margen_final_roll (vend_cc, fecha_dcto);

CREATE INDEX IF NOT EXISTS margen_final_roll_idx_fecha_vend_cc
  ON margen_final_roll (fecha_dcto, vend_cc);

CREATE INDEX IF NOT EXISTS margen_dinastia_roll_idx_vend_cc_fecha
  ON margen_dinastia_roll (vend_cc, fecha_dcto);

CREATE INDEX IF NOT EXISTS margen_dinastia_roll_idx_fecha_vend_cc
  ON margen_dinastia_roll (fecha_dcto, vend_cc);

-- Fallback si el roll aun no esta disponible.
CREATE INDEX IF NOT EXISTS margen_final_idx_vend_cc_fecha
  ON margen_final (vend_cc, fecha_dcto);

ANALYZE margen_final_roll;
ANALYZE margen_dinastia_roll;
ANALYZE margen_final;
