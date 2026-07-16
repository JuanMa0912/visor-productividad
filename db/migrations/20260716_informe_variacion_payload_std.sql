-- Snapshot JSON del payload de /informe-variacion (scope completo '*').
-- Materializar tras refresh de margen_item_dia_roll:
--   npx tsx scripts/warm-informe-variacion-snapshot.mts
--
-- Aplicar: node scripts/apply-migration-file.mjs db/migrations/20260716_informe_variacion_payload_std.sql

CREATE TABLE IF NOT EXISTS informe_variacion_payload_std (
  year smallint NOT NULL,
  month smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  range_id text NOT NULL,
  scope_key text NOT NULL DEFAULT '*',
  payload jsonb NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year, month, range_id, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_informe_variacion_payload_std_ym
  ON informe_variacion_payload_std (year DESC, month DESC);

COMMENT ON TABLE informe_variacion_payload_std IS
  'Payload JSON precargado de /informe-variacion (scope *= todas las sedes).';

CREATE TABLE IF NOT EXISTS informe_variacion_payload_std_meta (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  year smallint NOT NULL,
  month smallint NOT NULL,
  range_count integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE informe_variacion_payload_std_meta IS
  'Ultimo warm del snapshot de informe-variacion.';
