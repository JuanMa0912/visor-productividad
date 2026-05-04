-- Presets de items en Inventario x item, por usuario (persistente en servidor).

CREATE TABLE IF NOT EXISTS inventario_x_item_user_presets (
  user_id uuid PRIMARY KEY REFERENCES app_users (id) ON DELETE CASCADE,
  presets jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventario_x_item_user_presets_updated
  ON inventario_x_item_user_presets (updated_at DESC);
