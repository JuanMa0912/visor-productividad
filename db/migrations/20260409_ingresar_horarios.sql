CREATE TABLE IF NOT EXISTS horario_planillas (
  id bigserial PRIMARY KEY,
  sede text NOT NULL,
  seccion text NOT NULL,
  fecha_inicial date,
  fecha_final date,
  mes text,
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS horario_planilla_detalles (
  id bigserial PRIMARY KEY,
  planilla_id bigint NOT NULL REFERENCES horario_planillas(id) ON DELETE CASCADE,
  row_index integer NOT NULL CHECK (row_index >= 0),
  day_key text NOT NULL CHECK (
    day_key IN (
      'domingo',
      'lunes',
      'martes',
      'miercoles',
      'jueves',
      'viernes',
      'sabado'
    )
  ),
  worked_date date,
  employee_name text NOT NULL,
  employee_signature text,
  he1 time,
  hs1 time,
  he2 time,
  hs2 time,
  is_rest_day boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT horario_planilla_detalles_unique_row_day
    UNIQUE (planilla_id, row_index, day_key)
);

CREATE INDEX IF NOT EXISTS horario_planillas_idx_sede_fecha
  ON horario_planillas (sede, fecha_inicial, fecha_final);

CREATE INDEX IF NOT EXISTS horario_planillas_idx_created_at
  ON horario_planillas (created_at DESC);

CREATE INDEX IF NOT EXISTS horario_planilla_detalles_idx_planilla
  ON horario_planilla_detalles (planilla_id);

CREATE INDEX IF NOT EXISTS horario_planilla_detalles_idx_employee_date
  ON horario_planilla_detalles (employee_name, worked_date);

CREATE INDEX IF NOT EXISTS horario_planilla_detalles_idx_worked_date
  ON horario_planilla_detalles (worked_date);
