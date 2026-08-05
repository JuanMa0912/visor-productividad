-- Registro de visitas de proveedores (QR por sede) + catálogo.
-- Aplicar: node scripts/apply-migration-file.mjs db/migrations/20260805_proveedores_visitas.sql

CREATE TABLE IF NOT EXISTS proveedor_catalogo (
  id bigserial PRIMARY KEY,
  nombre text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS proveedor_catalogo_nombre_uidx
  ON proveedor_catalogo (lower(btrim(nombre)));

CREATE INDEX IF NOT EXISTS proveedor_catalogo_activo_nombre_idx
  ON proveedor_catalogo (activo, nombre);

COMMENT ON TABLE proveedor_catalogo IS
  'Maestro fijo de proveedores para el formulario QR (búsqueda / lista).';

CREATE TABLE IF NOT EXISTS proveedor_sede_qr (
  sede_name text PRIMARY KEY,
  token text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS proveedor_sede_qr_token_uidx
  ON proveedor_sede_qr (token);

COMMENT ON TABLE proveedor_sede_qr IS
  'Token opaco por sede para QR públicos /proveedores/ingreso/[token].';

CREATE TABLE IF NOT EXISTS proveedor_visitas (
  id bigserial PRIMARY KEY,
  sede_name text NOT NULL,
  proveedor_id bigint REFERENCES proveedor_catalogo (id) ON DELETE SET NULL,
  proveedor_nombre text NOT NULL,
  visitante_nombre text NOT NULL,
  visitante_cedula text NOT NULL,
  entrada_at timestamptz NOT NULL DEFAULT now(),
  salida_at timestamptz NULL,
  client_ip text NULL,
  user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proveedor_visitas_sede_entrada_idx
  ON proveedor_visitas (sede_name, entrada_at DESC);

CREATE INDEX IF NOT EXISTS proveedor_visitas_cedula_sede_open_idx
  ON proveedor_visitas (visitante_cedula, sede_name)
  WHERE salida_at IS NULL;

CREATE INDEX IF NOT EXISTS proveedor_visitas_entrada_idx
  ON proveedor_visitas (entrada_at DESC);

COMMENT ON TABLE proveedor_visitas IS
  'Visitas QR: entrada/salida. Visita abierta = salida_at IS NULL (por cédula+sede).';

-- 11 sedes operativas (sin Dinastía). Tokens opacos; rotar en DB si se filtran.
INSERT INTO proveedor_sede_qr (sede_name, token, activo) VALUES
  ('Calle 5ta', 'prv_f090df27e2d6e7931987d86ba37055fb7bda', true),
  ('La 39', 'prv_65db1a4a904ac774422611eccca5309d856d', true),
  ('Plaza Norte', 'prv_bfeea4768f7a682f4aede9ac8a6a2b6df51d', true),
  ('Ciudad Jardin', 'prv_73cd745055a528abb5c3d821fdb3f3f0dea9', true),
  ('Centro Sur', 'prv_83344ec4406e567cd08731fb3f8de84585fb', true),
  ('Palmira', 'prv_241923c99f7104be7b4a15969ca2601780fa', true),
  ('Floresta', 'prv_95669fd114e986899d8cf6234e410e527107', true),
  ('Floralia', 'prv_c4d3c26c1e4d9643f217c10a5380f66c2b88', true),
  ('Guaduales', 'prv_fd289be0f5be7cfef877581991b4af6c0350', true),
  ('Bogota', 'prv_08419c57ff2568b17ed959353a4ccc0767de', true),
  ('Chia', 'prv_debe76b54a1ac63826a251bb0486b3e77346', true)
ON CONFLICT (sede_name) DO NOTHING;
