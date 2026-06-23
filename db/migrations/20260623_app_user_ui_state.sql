-- Preferencias de UI por usuario (tutoriales vistos, etc.). Persistente en servidor.

CREATE TABLE IF NOT EXISTS app_user_ui_state (
  user_id uuid PRIMARY KEY REFERENCES app_users (id) ON DELETE CASCADE,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_user_ui_state_updated
  ON app_user_ui_state (updated_at DESC);
