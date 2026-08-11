-- Partir marcaciones QR en una tabla física por sede.
-- Aplicar: node scripts/apply-migration-file.mjs db/migrations/20260811_proveedor_visitas_por_sede.sql
--
-- Sedes canónicas (PROVEEDORES_QR_SEDES):
--   Calle 5ta, La 39, Plaza Norte, Ciudad Jardin, Centro Sur, Palmira,
--   Floresta, Floralia, Guaduales, Bogota, Chia

CREATE OR REPLACE FUNCTION _vp_create_qr_visitas_table(p_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS %I (
      id bigserial PRIMARY KEY,
      sede_name text NOT NULL,
      proveedor_id bigint,
      proveedor_nombre text NOT NULL,
      visitante_nombre text NOT NULL,
      visitante_cedula text NOT NULL,
      entrada_at timestamptz NOT NULL DEFAULT now(),
      salida_at timestamptz NULL,
      client_ip text NULL,
      user_agent text NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      proveedor_codigo text,
      proveedor_empresa text
    )
  $f$, p_table);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (entrada_at DESC)',
    p_table || '_entrada_idx',
    p_table
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (visitante_cedula) WHERE salida_at IS NULL',
    p_table || '_cedula_open_idx',
    p_table
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (proveedor_codigo)',
    p_table || '_proveedor_codigo_idx',
    p_table
  );
  EXECUTE format(
    'COMMENT ON TABLE %I IS %L',
    p_table,
    'Marcaciones QR de proveedores (entrada/salida) para una sede.'
  );
END;
$$;

SELECT _vp_create_qr_visitas_table('qr_calle_5ta');
SELECT _vp_create_qr_visitas_table('qr_la_39');
SELECT _vp_create_qr_visitas_table('qr_plaza_norte');
SELECT _vp_create_qr_visitas_table('qr_ciudad_jardin');
SELECT _vp_create_qr_visitas_table('qr_centro_sur');
SELECT _vp_create_qr_visitas_table('qr_palmira');
SELECT _vp_create_qr_visitas_table('qr_floresta');
SELECT _vp_create_qr_visitas_table('qr_floralia');
SELECT _vp_create_qr_visitas_table('qr_guaduales');
SELECT _vp_create_qr_visitas_table('qr_bogota');
SELECT _vp_create_qr_visitas_table('qr_chia');

DROP FUNCTION _vp_create_qr_visitas_table(text);

DO $$
DECLARE
  unknown_count int;
  pair record;
BEGIN
  IF to_regclass('public.proveedor_visitas') IS NULL THEN
    RAISE NOTICE 'proveedor_visitas no existe; tablas qr_* creadas vacías.';
    RETURN;
  END IF;

  -- Si ya es una vista de un deploy previo, no re-migrar.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'proveedor_visitas'
      AND c.relkind = 'v'
  ) THEN
    RAISE NOTICE 'proveedor_visitas ya es vista; migración omitida.';
    RETURN;
  END IF;

  IF to_regclass('public.proveedor_visitas_legacy') IS NOT NULL THEN
    RAISE NOTICE 'proveedor_visitas_legacy ya existe; migración de datos omitida.';
    RETURN;
  END IF;

  SELECT count(*)::int INTO unknown_count
  FROM proveedor_visitas
  WHERE NOT (
    sede_name = ANY (
      ARRAY[
        'Calle 5ta',
        'La 39',
        'Plaza Norte',
        'Ciudad Jardin',
        'Centro Sur',
        'Palmira',
        'Floresta',
        'Floralia',
        'Guaduales',
        'Bogota',
        'Chia'
      ]::text[]
    )
  );

  IF unknown_count > 0 THEN
    RAISE EXCEPTION
      'proveedor_visitas tiene % filas con sede_name fuera del mapa QR; abortando.',
      unknown_count;
  END IF;

  FOR pair IN
    SELECT * FROM (VALUES
      ('Calle 5ta', 'qr_calle_5ta'),
      ('La 39', 'qr_la_39'),
      ('Plaza Norte', 'qr_plaza_norte'),
      ('Ciudad Jardin', 'qr_ciudad_jardin'),
      ('Centro Sur', 'qr_centro_sur'),
      ('Palmira', 'qr_palmira'),
      ('Floresta', 'qr_floresta'),
      ('Floralia', 'qr_floralia'),
      ('Guaduales', 'qr_guaduales'),
      ('Bogota', 'qr_bogota'),
      ('Chia', 'qr_chia')
    ) AS t(sede_name, table_name)
  LOOP
    EXECUTE format(
      $f$
      INSERT INTO %I (
        id, sede_name, proveedor_id, proveedor_nombre,
        visitante_nombre, visitante_cedula, entrada_at, salida_at,
        client_ip, user_agent, created_at, proveedor_codigo, proveedor_empresa
      )
      SELECT
        id, sede_name, proveedor_id, proveedor_nombre,
        visitante_nombre, visitante_cedula, entrada_at, salida_at,
        client_ip, user_agent, created_at, proveedor_codigo, proveedor_empresa
      FROM proveedor_visitas
      WHERE sede_name = $1
      ON CONFLICT (id) DO NOTHING
      $f$,
      pair.table_name
    )
    USING pair.sede_name;

    EXECUTE format(
      $f$
      SELECT setval(
        pg_get_serial_sequence(%L, 'id'),
        COALESCE((SELECT MAX(id) FROM %I), 1),
        true
      )
      $f$,
      pair.table_name,
      pair.table_name
    );
  END LOOP;

  ALTER TABLE proveedor_visitas RENAME TO proveedor_visitas_legacy;

  COMMENT ON TABLE proveedor_visitas_legacy IS
    'Legacy pre-split QR por sede (20260811). No escribir desde la app; rollback / auditoría.';
END;
$$;

-- Vista de solo lectura para consultas ad-hoc / compat.
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
