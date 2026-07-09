-- Perfil Asadero: quitar rol especial alex (reporte Alex en jornada extendida).
UPDATE app_users
SET special_roles = array_remove(special_roles, 'alex')
WHERE portal_profile = 'asadero'
  AND 'alex' = ANY(COALESCE(special_roles, ARRAY[]::text[]));

UPDATE app_users
SET special_roles = NULL
WHERE portal_profile = 'asadero'
  AND special_roles IS NOT NULL
  AND COALESCE(array_length(special_roles, 1), 0) = 0;
