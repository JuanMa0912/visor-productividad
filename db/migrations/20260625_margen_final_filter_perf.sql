-- Indices alineados a filtros del tablero /margenes (fecha + sede normalizada).
-- Tras carga masiva, ANALYZE ayuda al planner con ~8M filas.

CREATE INDEX IF NOT EXISTS margen_final_idx_fecha_sede_norm
  ON margen_final (
    fecha_dcto,
    lower(trim(COALESCE(empresa, ''))),
    lpad(trim(COALESCE(id_co, '')), 3, '0')
  );

CREATE INDEX IF NOT EXISTS margen_final_idx_fecha_tipo
  ON margen_final (fecha_dcto, id_tipo)
  WHERE id_tipo IS NOT NULL;

ANALYZE margen_final;
