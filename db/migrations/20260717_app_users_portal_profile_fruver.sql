-- Perfil Fruver: mismos tableros que Asadero, linea fija en fruver (N1 01).
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
      'fruver',
      'rrhh',
      'personalizado'
    )
  );

COMMENT ON COLUMN app_users.portal_profile IS
  'Perfil de negocio del portal (admin, subadmin, gerente, director_comercial, asadero, fruver, rrhh, personalizado).';

-- LHERRERA: espejo del perfil asadero pero con fruver.
UPDATE app_users
SET
  portal_profile = 'fruver',
  role = 'user',
  allowed_lines = ARRAY['fruver']::text[],
  allowed_dashboards = ARRAY['producto', 'operacion']::text[],
  allowed_subdashboards = ARRAY[
    'mix-y-linea',
    'margenes',
    'rotacion',
    'informe-variacion',
    'consulta-operativa',
    'planilla-vs-asistencia',
    'registro-de-horarios'
  ]::text[],
  special_roles = ARRAY[
    'comparar_horarios',
    'replicar_lunes',
    'crear_horario_predeterminado',
    'abcd',
    'historial_sinventario'
  ]::text[],
  allowed_sedes = COALESCE(
    NULLIF(allowed_sedes, ARRAY[]::text[]),
    ARRAY['Todas']::text[]
  ),
  updated_at = NOW()
WHERE LOWER(username) = 'lherrera';
