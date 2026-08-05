-- Apunta visitas QR al maestro POS existente (proveedor_pos_catalogo).
-- Aplicar: node scripts/apply-migration-file.mjs db/migrations/20260805_proveedores_visitas_pos_catalog.sql

ALTER TABLE proveedor_visitas
  ADD COLUMN IF NOT EXISTS proveedor_codigo text,
  ADD COLUMN IF NOT EXISTS proveedor_empresa text;

-- Quitar FK al catálogo vacío propio (si existía).
ALTER TABLE proveedor_visitas
  DROP CONSTRAINT IF EXISTS proveedor_visitas_proveedor_id_fkey;

COMMENT ON COLUMN proveedor_visitas.proveedor_codigo IS
  'id_cricla1 de proveedor_pos_catalogo';
COMMENT ON COLUMN proveedor_visitas.proveedor_empresa IS
  'empresa de la fila elegida en proveedor_pos_catalogo';

CREATE INDEX IF NOT EXISTS proveedor_visitas_proveedor_codigo_idx
  ON proveedor_visitas (proveedor_codigo);
