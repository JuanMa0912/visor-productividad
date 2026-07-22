-- Performance pestaña Por Cliente + detalle de factura en /margenes.
--
-- Medido en local (~6M filas en jul/2026, ~42M en roll completo):
--   Lista clientes (GROUP BY id_terc): ~25s Parallel Seq Scan
--   Facturas de un cliente (id_terc = ...): ~36s Seq Scan (sin indice)
--   Lineas de factura (documento_fc + sede): ~2s Index Scan PK ineficiente
--     (documento esta al final del PK; Index Searches: 405)
--
-- Ademas la API corria queryKpi + queryCliente* en paralelo = 2 barridos.
--
-- Indices:
--   1) id_terc + fecha  -> facturas de un cliente
--   2) fecha + id_terc  -> agregacion por cliente en ventana de fechas
--   3) documento + tipdoc + sede + fecha -> detalle de factura
--
-- En tablas grandes vivas preferir CONCURRENTLY a mano:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS ... ;

CREATE INDEX IF NOT EXISTS margen_final_roll_idx_terc_fecha
  ON margen_final_roll (id_terc, fecha_dcto);

CREATE INDEX IF NOT EXISTS margen_final_roll_idx_fecha_terc
  ON margen_final_roll (fecha_dcto, id_terc);

CREATE INDEX IF NOT EXISTS margen_final_roll_idx_documento
  ON margen_final_roll (
    documento_fc,
    id_tipdoc_fc,
    empresa_norm,
    id_co_norm,
    fecha_dcto
  );

-- Fallback si el roll aun no esta disponible.
CREATE INDEX IF NOT EXISTS margen_final_idx_terc_fecha
  ON margen_final (id_terc, fecha_dcto);

CREATE INDEX IF NOT EXISTS margen_final_idx_documento_sede
  ON margen_final (
    documento_fc,
    id_tipdoc_fc,
    lower(trim(COALESCE(empresa, ''))),
    lpad(trim(COALESCE(id_co, '')), 3, '0'),
    fecha_dcto
  );

ANALYZE margen_final_roll;
ANALYZE margen_final;
