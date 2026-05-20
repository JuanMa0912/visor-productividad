-- Path actual del usuario en la app (tablero/seccion en que se encuentra).
-- Lo escribe el heartbeat /api/auth/heartbeat y lo consume el panel
-- /admin/usuarios y el registro de accesos para mostrar "Tablero actual".

ALTER TABLE app_user_sessions
  ADD COLUMN IF NOT EXISTS last_path text;
