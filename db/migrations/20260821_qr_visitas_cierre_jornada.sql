-- Cierre de jornada QR: visitas abiertas de días anteriores y salidas al día siguiente.
-- Aplicar: node scripts/apply-migration-file.mjs db/migrations/20260821_qr_visitas_cierre_jornada.sql
--
-- Una visita de proveedor no cruza medianoche America/Bogota. Si no marcaron
-- salida el mismo día, se imputa 21:00 (o 15 min después de entrar si ya era noche).

DO $$
DECLARE
  t text;
  cierre text := $c$
    GREATEST(
      entrada_at + interval '15 minutes',
      (timezone('America/Bogota', entrada_at)::date + time '21:00')
        AT TIME ZONE 'America/Bogota'
    )
  $c$;
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
      'UPDATE %I SET salida_at = %s
       WHERE salida_at IS NULL
         AND timezone(''America/Bogota'', entrada_at)::date
           < timezone(''America/Bogota'', now())::date',
      t,
      cierre
    );

    EXECUTE format(
      'UPDATE %I SET salida_at = LEAST(salida_at, %s)
       WHERE salida_at IS NOT NULL
         AND timezone(''America/Bogota'', salida_at)::date
           > timezone(''America/Bogota'', entrada_at)::date',
      t,
      cierre
    );
  END LOOP;
END;
$$;
