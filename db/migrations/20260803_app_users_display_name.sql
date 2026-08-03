-- Nombre real / nota visible bajo el username en /admin/usuarios.
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS display_name text;

COMMENT ON COLUMN app_users.display_name IS
  'Nombre de la persona dueña de la cuenta (o nota corta). Visible bajo el username en admin.';
