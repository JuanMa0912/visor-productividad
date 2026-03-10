-- Migration: base tables for Ventas X item dashboard

CREATE TABLE IF NOT EXISTS ventas_item_cargas (
  id bigserial PRIMARY KEY,
  source_name text,
  source_hash text,
  source_rows integer,
  loaded_by text,
  notes text,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ventas_item_diario (
  id bigserial PRIMARY KEY,
  empresa text NOT NULL,
  fecha_dcto text NOT NULL,
  id_co text NOT NULL,
  id_item text NOT NULL,
  descripcion text NOT NULL,
  linea text NOT NULL,
  und_dia numeric(18,4) NOT NULL DEFAULT 0,
  venta_sin_impuesto_dia numeric(18,4) NOT NULL DEFAULT 0,
  und_acum numeric(18,4) NOT NULL DEFAULT 0,
  venta_sin_impuesto_acum numeric(18,4) NOT NULL DEFAULT 0,
  empresa_norm text,
  id_co_norm text,
  sede text,
  source_load_id bigint REFERENCES ventas_item_cargas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ventas_item_sede_map (
  empresa_norm text NOT NULL,
  id_co_norm text NOT NULL,
  sede text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_norm, id_co_norm)
);

INSERT INTO ventas_item_sede_map (empresa_norm, id_co_norm, sede)
VALUES
  ('mercamio', '001', 'La 5'),
  ('mercamio', '002', 'La 39'),
  ('mercamio', '003', 'Plaza'),
  ('mercamio', '004', 'Jardin'),
  ('mercamio', '005', 'C.sur'),
  ('mercamio', '006', 'Palmira'),
  ('mtodo', '001', 'Floresta'),
  ('mtodo', '002', 'Floralia'),
  ('mtodo', '003', 'Guaduales'),
  ('bogota', '001', 'La 80'),
  ('bogota', '002', 'Chia')
ON CONFLICT (empresa_norm, id_co_norm) DO UPDATE
SET
  sede = EXCLUDED.sede,
  updated_at = now();

CREATE UNIQUE INDEX IF NOT EXISTS ventas_item_diario_uq_natural
ON ventas_item_diario (
  fecha_dcto,
  COALESCE(empresa_norm, empresa),
  COALESCE(id_co_norm, id_co),
  id_item,
  linea
);

CREATE INDEX IF NOT EXISTS ventas_item_diario_idx_fecha
ON ventas_item_diario (fecha_dcto);

CREATE INDEX IF NOT EXISTS ventas_item_diario_idx_empresa
ON ventas_item_diario (COALESCE(empresa_norm, empresa));

CREATE INDEX IF NOT EXISTS ventas_item_diario_idx_item
ON ventas_item_diario (id_item);

CREATE INDEX IF NOT EXISTS ventas_item_diario_idx_sede
ON ventas_item_diario (sede);
