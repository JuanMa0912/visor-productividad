-- Perfil de portal (reemplaza la configuración manual de permisos para roles fijos).
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS portal_profile text;

UPDATE app_users
SET portal_profile = CASE
  WHEN role = 'admin' THEN 'admin'
  ELSE 'personalizado'
END
WHERE portal_profile IS NULL;

ALTER TABLE app_users
  ALTER COLUMN portal_profile SET DEFAULT 'personalizado';

ALTER TABLE app_users
  DROP CONSTRAINT IF EXISTS app_users_portal_profile_check;

ALTER TABLE app_users
  ADD CONSTRAINT app_users_portal_profile_check
  CHECK (
    portal_profile IN (
      'admin',
      'subadmin',
      'gerente',
      'director_comercial',
      'rrhh',
      'personalizado'
    )
  );

COMMENT ON COLUMN app_users.portal_profile IS
  'Perfil de negocio del portal. Los permisos granulares se materializan al guardar.';
