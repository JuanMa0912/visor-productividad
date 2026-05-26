-- Registro granular de actividad por usuario.
-- Cada fila representa un heartbeat (~1/min cuando el usuario interactua).
-- Permite calcular: tiempo activo, top secciones, frecuencia, dispositivos.

CREATE TABLE IF NOT EXISTS app_user_activity_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES app_user_sessions(id) ON DELETE SET NULL,
  path text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_user_activity_user_time
  ON app_user_activity_log (user_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_user_activity_path
  ON app_user_activity_log (path);

CREATE INDEX IF NOT EXISTS idx_app_user_activity_session
  ON app_user_activity_log (session_id);
