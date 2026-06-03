-- Bug fix: el sede_id NO es unico entre empresas (Mercamio 001=Calle 5ta,
-- Mercatodo 001=Floresta, Merkmios 001=Bogota). La PK previa
-- (sede_id, item, context) producia colisiones: cuando el admin de
-- Floresta (empresa=mtodo, sede_id=001) marcaba un item como "Surtido",
-- el ON CONFLICT pisaba o leia la fila del admin de Calle 5ta
-- (empresa=mercamio, sede_id=001) con el mismo sede_id. La nueva PK
-- incluye empresa para que cada sede sea totalmente independiente.
--
-- Aplica a la tabla viva (rotacion_cero_item_estado) y a su audit
-- (rotacion_cero_item_estado_audit). Las filas previas se conservan con
-- empresa = '' como huerfanas: no las matchean los queries nuevos
-- (que siempre pasan una empresa real), asi que efectivamente quedan
-- congeladas. Si quieres limpiarlas manualmente despues, se puede
-- ejecutar `DELETE FROM rotacion_cero_item_estado WHERE empresa = '';`
-- (la audit es mejor preservarla aunque la atribucion historica sea
-- ambigua para registros previos a este fix).

-- ── 1. Tabla viva ──────────────────────────────────────────────────────────
ALTER TABLE rotacion_cero_item_estado
  ADD COLUMN IF NOT EXISTS empresa text NOT NULL DEFAULT '';

ALTER TABLE rotacion_cero_item_estado
  ALTER COLUMN empresa DROP DEFAULT;

ALTER TABLE rotacion_cero_item_estado
  DROP CONSTRAINT IF EXISTS rotacion_cero_item_estado_pkey;

ALTER TABLE rotacion_cero_item_estado
  ADD PRIMARY KEY (empresa, sede_id, item, context);

-- ── 2. Tabla de audit ──────────────────────────────────────────────────────
ALTER TABLE rotacion_cero_item_estado_audit
  ADD COLUMN IF NOT EXISTS empresa text NOT NULL DEFAULT '';

ALTER TABLE rotacion_cero_item_estado_audit
  ALTER COLUMN empresa DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_rotacion_cero_audit_empresa_sede_changed
  ON rotacion_cero_item_estado_audit (empresa, sede_id, changed_at DESC);
