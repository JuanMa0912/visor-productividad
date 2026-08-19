-- Foto de evidencia cuando un item restock queda en estado surtido.
-- Se guarda en texto base64 (JPEG) para viajar en SQL parametrizado sin BYTEA.

CREATE TABLE IF NOT EXISTS rotacion_restock_surtido_foto (
  empresa text NOT NULL,
  sede_id text NOT NULL,
  item text NOT NULL,
  foto_base64 text NOT NULL,
  mime text NOT NULL DEFAULT 'image/jpeg'
    CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  PRIMARY KEY (empresa, sede_id, item)
);

CREATE INDEX IF NOT EXISTS idx_rotacion_restock_surtido_foto_updated
  ON rotacion_restock_surtido_foto (updated_at DESC);

COMMENT ON TABLE rotacion_restock_surtido_foto IS
  'Evidencia fotografica (base64) de items restock marcados como surtido.';
