-- Presencia en tiempo real para /admin/usuarios.
-- Anade un timestamp por sesion que se actualiza en cada request autenticado;
-- a partir de este campo se calcula si el usuario esta activo, ausente o desconectado.

ALTER TABLE app_user_sessions
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_app_user_sessions_user_active
  ON app_user_sessions (user_id, last_activity_at DESC)
  WHERE revoked_at IS NULL;
