-- Estado operativo por item en vista "Cero rotacion" (por sede).

CREATE TABLE IF NOT EXISTS rotacion_cero_item_estado (
  sede_id text NOT NULL,
  item text NOT NULL,
  estado text NOT NULL CHECK (
    estado IN ('sin_verificar', 'seguimiento', 'surtido')
  ),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  PRIMARY KEY (sede_id, item)
);

CREATE INDEX IF NOT EXISTS idx_rotacion_cero_item_estado_updated
  ON rotacion_cero_item_estado (updated_at DESC);
