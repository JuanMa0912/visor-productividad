-- Bitacora de descargas/exports (solo metadatos; no se guarda el archivo).
-- Retencion operativa: 9 meses (scripts/cleanup-logs.sh).
-- Aplicar: node scripts/apply-migration-file.mjs db/migrations/20260721_app_export_download_log.sql

CREATE TABLE IF NOT EXISTS app_export_download_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  username text NOT NULL,
  panel_path text NOT NULL,
  panel_label text,
  export_kind text NOT NULL,
  format text NOT NULL CHECK (
    format IN ('xlsx', 'pdf', 'csv', 'png', 'jpeg', 'other')
  ),
  file_name text NOT NULL,
  date_from text,
  date_to text,
  filters jsonb,
  row_count integer,
  byte_size integer,
  source text NOT NULL DEFAULT 'client' CHECK (source IN ('client', 'api')),
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_export_download_created
  ON app_export_download_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_export_download_user_time
  ON app_export_download_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_export_download_panel_time
  ON app_export_download_log (panel_path, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_export_download_username_time
  ON app_export_download_log (lower(username), created_at DESC);

COMMENT ON TABLE app_export_download_log IS
  'Metadatos de exports/descargas (Excel/PDF/CSV/imagen). Sin contenido del archivo. Retencion ~9 meses.';
