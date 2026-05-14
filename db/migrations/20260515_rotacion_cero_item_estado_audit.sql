-- Historial de cambios de S.inventario (cero rotacion / restock).

CREATE TABLE IF NOT EXISTS rotacion_cero_item_estado_audit (
  id bigserial PRIMARY KEY,
  sede_id text NOT NULL,
  item text NOT NULL,
  context text NOT NULL DEFAULT 'cero' CHECK (context IN ('cero', 'restock')),
  estado_anterior text NULL,
  estado_nuevo text NOT NULL CHECK (
    estado_nuevo IN ('sin_verificar', 'seguimiento', 'surtido')
  ),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_rotacion_cero_audit_sede_changed
  ON rotacion_cero_item_estado_audit (sede_id, changed_at DESC);
