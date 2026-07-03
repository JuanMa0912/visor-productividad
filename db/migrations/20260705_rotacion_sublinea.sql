-- Sublinea (linea nivel 2) en rotacion.
-- Agrega id_linea_nivel_2 / nombre_linea_nivel_2 a rotacion_base_item_dia_sede.
-- El ETL etl_rotacion_v3.py las puebla desde items.id_linea2 (+ tabla lineas),
-- en paralelo a id_linea_nivel_1. La matview rotacion_item_dia_clean las expone
-- como sublinea/sublinea_codigo (ver migracion del matview).
--
-- Idempotente (ADD COLUMN IF NOT EXISTS). Aplicar en LOCAL (232) Y GCP (Cloud SQL):
-- el CREATE TABLE IF NOT EXISTS del ETL no altera una tabla ya existente.

ALTER TABLE public.rotacion_base_item_dia_sede
  ADD COLUMN IF NOT EXISTS id_linea_nivel_2     VARCHAR(10),
  ADD COLUMN IF NOT EXISTS nombre_linea_nivel_2 VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_rot_v3_linea2_fecha
  ON public.rotacion_base_item_dia_sede (id_linea_nivel_2, fecha_dia);
