-- Dinastia: tablas dedicadas + alcance por empresa.
--
-- GCP (Cloud SQL) YA tiene margen_dinastia / rotacion_dinastia / ventas_dinastia
-- con datos. Esta migracion es idempotente (IF NOT EXISTS) para entornos vacios.
--
-- Sedes confirmadas (GCP):
--   id_co/sede 001 = Dinastia 1 Santa Elena
--   id_co/sede 002 = Dinastia 2 CR Primera
--
-- Nota ventas_dinastia: la columna `linea` existe y es NOT NULL, pero en el
-- feed actual parece codigo de caja/POS (01, 05, 56...), no la linea de
-- productividad (cajas/fruver/...). `categoria` viene como '1'. Revisar ETL
-- antes de filtrar productividad por linea.

CREATE TABLE IF NOT EXISTS margen_dinastia (
  LIKE margen_final INCLUDING DEFAULTS INCLUDING COMMENTS
);

CREATE INDEX IF NOT EXISTS margen_dinastia_idx_fecha
  ON margen_dinastia (fecha_dcto);

CREATE INDEX IF NOT EXISTS margen_dinastia_idx_empresa_co_fecha
  ON margen_dinastia (
    lower(trim(COALESCE(empresa, ''))),
    lpad(trim(COALESCE(id_co, '')), 3, '0'),
    fecha_dcto
  );

CREATE INDEX IF NOT EXISTS margen_dinastia_idx_documento
  ON margen_dinastia (
    documento_fc,
    id_tipdoc_fc,
    lower(trim(COALESCE(empresa, ''))),
    lpad(trim(COALESCE(id_co, '')), 3, '0'),
    fecha_dcto
  );

CREATE TABLE IF NOT EXISTS rotacion_dinastia (
  LIKE rotacion_base_item_dia_sede INCLUDING DEFAULTS INCLUDING COMMENTS
);

CREATE INDEX IF NOT EXISTS rotacion_dinastia_idx_fecha_empresa_sede
  ON rotacion_dinastia (fecha_dia, empresa, sede);

CREATE TABLE IF NOT EXISTS ventas_dinastia (
  LIKE ventas_cajas INCLUDING DEFAULTS INCLUDING COMMENTS
);

ALTER TABLE ventas_dinastia
  ADD COLUMN IF NOT EXISTS linea text;

COMMENT ON COLUMN ventas_dinastia.linea IS
  'Discriminador de linea de productividad (cajas, fruver, industria, carnes, pollo y pescado, asadero).';

CREATE INDEX IF NOT EXISTS ventas_dinastia_idx_fecha_co_empresa
  ON ventas_dinastia (fecha_dcto, centro_operacion, empresa_bd);

CREATE INDEX IF NOT EXISTS ventas_dinastia_idx_linea_fecha
  ON ventas_dinastia (linea, fecha_dcto);

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS allowed_empresas jsonb;

COMMENT ON COLUMN app_users.allowed_empresas IS
  'JSON array de empresas BD permitidas (mercamio, mtodo, bogota, dinastia). NULL = todas (tipico admin).';

UPDATE app_users
SET allowed_empresas = NULL
WHERE allowed_empresas = '[]'::jsonb;
