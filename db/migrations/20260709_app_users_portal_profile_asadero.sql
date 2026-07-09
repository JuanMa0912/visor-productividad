-- Perfil Asadero: producto + operación restringidos a categoría Asaderos.
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
      'asadero',
      'rrhh',
      'personalizado'
    )
  );

COMMENT ON COLUMN app_users.portal_profile IS
  'Perfil de negocio del portal (admin, subadmin, gerente, director_comercial, asadero, rrhh, personalizado).';
