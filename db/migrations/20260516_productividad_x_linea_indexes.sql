-- Índices para productividad por línea y análisis que agrupan ventas por sede/fecha.
-- Tablas: src/app/api/productivity/route.ts (LINE_TABLES) y hourly-analysis sobre ventas_cajas.

CREATE INDEX IF NOT EXISTS idx_ventas_cajas_prod_fecha_co_empresa
  ON ventas_cajas (fecha_dcto, centro_operacion, empresa_bd)
  WHERE fecha_dcto IS NOT NULL AND centro_operacion IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_fruver_prod_fecha_co_empresa
  ON ventas_fruver (fecha_dcto, centro_operacion, empresa_bd)
  WHERE fecha_dcto IS NOT NULL AND centro_operacion IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_industria_prod_fecha_co_empresa
  ON ventas_industria (fecha_dcto, centro_operacion, empresa_bd)
  WHERE fecha_dcto IS NOT NULL AND centro_operacion IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_carnes_prod_fecha_co_empresa
  ON ventas_carnes (fecha_dcto, centro_operacion, empresa_bd)
  WHERE fecha_dcto IS NOT NULL AND centro_operacion IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_pollo_pesc_prod_fecha_co_empresa
  ON ventas_pollo_pesc (fecha_dcto, centro_operacion, empresa_bd)
  WHERE fecha_dcto IS NOT NULL AND centro_operacion IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_asadero_prod_fecha_co_empresa
  ON ventas_asadero (fecha_dcto, centro_operacion, empresa_bd)
  WHERE fecha_dcto IS NOT NULL AND centro_operacion IS NOT NULL;

-- Horas laboradas agrupadas por día / sede / departamento (misma API de productividad).
CREATE INDEX IF NOT EXISTS idx_asistencia_horas_prod_fecha_sede_depto
  ON asistencia_horas (fecha, sede, departamento)
  WHERE fecha IS NOT NULL AND sede IS NOT NULL AND departamento IS NOT NULL;
