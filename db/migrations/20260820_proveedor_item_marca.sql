-- ---------------------------------------------------------------------------
-- Marca del item en el puente proveedor_item
-- ---------------------------------------------------------------------------
-- La marca comercial vive en el POS como criterios_itm_2, el mismo mecanismo de
-- criterios con el que ya se resuelve el proveedor (criterios_itm_1). El join
-- items.id_cricla2 = criterios_itm_2.id_cricla2 AND items.id_tipo = .id_catego
-- se verifico 1:1 sin fan-out contra el POS de mercamio: 48.390 items entran,
-- 48.390 salen. Cobertura del nombre: 84,4% (40.840 de 48.390).
--
-- Se guarda denormalizada (codigo + nombre) en el puente que ya existe en vez de
-- crear tablas y un sync nuevos: son ~48k filas por empresa y el tablero ya hace
-- join contra proveedor_item, asi que la marca le llega sin consultas extra.
--
-- OJO: la marca es del PRODUCTO, no del proveedor. Un mismo proveedor surte
-- varias marcas y una marca puede llegar por varios proveedores.

ALTER TABLE proveedor_item
  ADD COLUMN IF NOT EXISTS id_cricla2 text,
  ADD COLUMN IF NOT EXISTS marca text;

-- Filtrar por marca sin escanear el puente entero.
CREATE INDEX IF NOT EXISTS proveedor_item_idx_marca
ON proveedor_item (empresa, marca)
WHERE marca IS NOT NULL;
