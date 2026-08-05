-- Migration: inventario valorizado POR PROVEEDOR (tablero de proveedores)
--
-- Complementa db/migrations/20260805_ventas_proveedor.sql. Alimentado por el mismo
-- scripts/etl/proveedores/etl_proveedores.py y replicado a GCP por sync-local-to-gcp.sh.
--
-- DE DONDE SALE EL INVENTARIO:
-- de public.rotacion_base_item_dia_sede, que ya vive en la 232 (la deja el ETL de rotacion)
-- y ya se replica a GCP. NO hace falta volver a leer el POS para esto.
--   valorizado = can_disponible_foto * costo_uni_inventario
-- Verificado sobre la foto del 2026-08-04 (209.921 filas):
--   - UNA sola fila por (empresa, sede, id_item) -> sumar por sede NO duplica.
--   - inv_foto_bloqueada = true en el 100% de las filas: es un estado, no un filtro.
--   - 0 inventarios negativos y 0 costos nulos. Valorizado total: 36.470.416.089.
--
-- EL PROBLEMA QUE RESUELVE proveedor_item:
-- rotacion_base_item_dia_sede tiene id_item pero NO tiene proveedor, y ventas_proveedor_dia
-- ya viene agregada (perdio el id_item). Sin un puente item->proveedor no hay forma de
-- valorizar el inventario por proveedor. Formatos verificados: id_item es char(6) sin
-- padding en ambos lados y cruzan 8.443 de 8.470 items vendidos.

-- ---------------------------------------------------------------------------
-- 1) PUENTE item -> proveedor
-- ---------------------------------------------------------------------------
-- ~40.800 filas utiles por empresa. Se carga por reemplazo total transaccional desde el POS
-- (items JOIN criterios_itm_1). Sirve para el inventario y habilita el drill a nivel item.
CREATE TABLE IF NOT EXISTS proveedor_item (
  empresa text NOT NULL,
  id_item text NOT NULL,
  id_cricla1 text NOT NULL,          -- codigo de proveedor; '@SP' = sin proveedor asignado
  descripcion text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, id_item)
);

CREATE INDEX IF NOT EXISTS proveedor_item_idx_cricla
ON proveedor_item (empresa, id_cricla1);

-- ---------------------------------------------------------------------------
-- 2) HECHOS: inventario valorizado por proveedor, dia y sede
-- ---------------------------------------------------------------------------
-- Mismo grano y mismas llaves que ventas_proveedor_dia, para que el tablero pueda cruzar
-- venta e inventario sin malabares: (empresa, id_co, id_cricla1).
-- OJO: aqui la fecha es DATE (fecha_dia), no text YYYYMMDD, porque asi viene de rotacion.
-- Solo se guardan filas con existencia distinta de cero: valorizar un cero no aporta y
-- multiplicaria el tamano de la tabla por 6.
CREATE TABLE IF NOT EXISTS inventario_proveedor_dia (
  id bigserial PRIMARY KEY,
  empresa text NOT NULL,                        -- mercamio | mtodo | bogota
  fecha_dia date NOT NULL,                      -- fecha de la foto de inventario
  id_co text NOT NULL,                          -- = rotacion_base_item_dia_sede.sede (001, 002, CEI, IMP...)
  sede text,                                    -- etiqueta del portal (ventas_item_sede_map)
  id_cricla1 text NOT NULL,
  proveedor text NOT NULL,                      -- nombre denormalizado, igual que en ventas_proveedor_dia
  items_con_stock integer NOT NULL DEFAULT 0,
  unidades numeric(18,4) NOT NULL DEFAULT 0,    -- SUM(can_disponible_foto)
  valorizado numeric(18,4) NOT NULL DEFAULT 0,  -- SUM(can_disponible_foto * costo_uni_inventario), al COSTO
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Clave natural con columnas planas, igual que ventas_proveedor_dia: el ON CONFLICT (KEY)
-- por defecto de sync-local-to-gcp.sh sirve tal cual.
CREATE UNIQUE INDEX IF NOT EXISTS inventario_proveedor_dia_uq_natural
ON inventario_proveedor_dia (empresa, fecha_dia, id_co, id_cricla1);

-- El tablero pide la foto mas reciente y agrupa por proveedor. Indice cubridor.
CREATE INDEX IF NOT EXISTS inventario_proveedor_dia_idx_fecha_cover
ON inventario_proveedor_dia (fecha_dia, empresa, id_cricla1)
INCLUDE (unidades, valorizado, items_con_stock);

CREATE INDEX IF NOT EXISTS inventario_proveedor_dia_idx_prov
ON inventario_proveedor_dia (id_cricla1, fecha_dia);
