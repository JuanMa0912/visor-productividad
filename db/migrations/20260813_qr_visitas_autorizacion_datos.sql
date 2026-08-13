-- Autorización habeas data (Ley 1581) en marcaciones QR de proveedores.
-- Aplicar: node scripts/apply-migration-file.mjs db/migrations/20260813_qr_visitas_autorizacion_datos.sql
--
-- `autorizacion_datos_at` = momento en que el visitante aceptó el tratamiento
-- al registrar la entrada. NULL = visitas anteriores a esta migración.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'qr_calle_5ta',
    'qr_la_39',
    'qr_plaza_norte',
    'qr_ciudad_jardin',
    'qr_centro_sur',
    'qr_palmira',
    'qr_floresta',
    'qr_floralia',
    'qr_guaduales',
    'qr_bogota',
    'qr_chia'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '% no existe; se omite.', t;
      CONTINUE;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS autorizacion_datos_at timestamptz NULL',
      t
    );
    EXECUTE format(
      'COMMENT ON COLUMN %I.autorizacion_datos_at IS %L',
      t,
      'Momento de autorización de tratamiento de datos (Ley 1581) al registrar entrada QR.'
    );
  END LOOP;
END;
$$;

DROP VIEW IF EXISTS proveedor_visitas;
CREATE VIEW proveedor_visitas AS
  SELECT * FROM qr_calle_5ta
  UNION ALL SELECT * FROM qr_la_39
  UNION ALL SELECT * FROM qr_plaza_norte
  UNION ALL SELECT * FROM qr_ciudad_jardin
  UNION ALL SELECT * FROM qr_centro_sur
  UNION ALL SELECT * FROM qr_palmira
  UNION ALL SELECT * FROM qr_floresta
  UNION ALL SELECT * FROM qr_floralia
  UNION ALL SELECT * FROM qr_guaduales
  UNION ALL SELECT * FROM qr_bogota
  UNION ALL SELECT * FROM qr_chia;

COMMENT ON VIEW proveedor_visitas IS
  'Solo lectura: UNION ALL de qr_* por sede. La app escribe en la tabla física de cada sede.';
