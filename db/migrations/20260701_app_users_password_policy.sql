-- Política de contraseñas: fecha del último cambio y sesiones con cambio obligatorio.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

ALTER TABLE app_users
  ALTER COLUMN password_changed_at SET DEFAULT now();

ALTER TABLE app_user_sessions
  ADD COLUMN IF NOT EXISTS password_change_required boolean NOT NULL DEFAULT false;

ALTER TABLE app_user_sessions
  ADD COLUMN IF NOT EXISTS password_change_reason text;

-- Usuarios existentes: arrancar ventana de 30 días desde la última actualización conocida.
UPDATE app_users
SET password_changed_at = COALESCE(password_changed_at, updated_at, created_at, now())
WHERE password_changed_at IS NULL;
