-- Migration: modulo de proveedores (tablero /proveedores)
--
-- Alimentado por scripts/etl/proveedores/etl_proveedores.py (POS 217 -> produXdia 232)
-- y replicado a GCP por scripts/etl/sync-local-to-gcp.sh.
--
-- POR QUE UNA TABLA DE HECHOS PROPIA Y NO UN JOIN CONTRA ventas_item_diario:
-- el grano proveedor x dia x sede comprime 14x respecto del grano item (medido en mtodo:
-- 281.846 filas de item -> 20.137 filas de proveedor en 30 dias). Con las 3 empresas son
-- ~60k filas/mes, ~730k/ano: una tabla chica que GCP sirve sin rollup ni matview.
-- Ademas permite calcular la plata correctamente desde el origen sin heredar el problema
-- de ventas_item_diario.venta_sin_impuesto_dia (ver nota de columnas mas abajo).
--
-- ORIGEN DEL PROVEEDOR (verificado en vivo contra 192.168.35.217/mtodo):
--   items.id_cricla1 = criterios_itm_1.id_cricla1 AND items.id_tipo = criterios_itm_1.id_catego
-- Es 1:1 sin fan-out (40.811 items con criterio -> 40.811 pares). Lo confirma la vista
-- informes.v_eos_items del POS, que aliasa cr1.cmcricla_descripcion AS proveedor.
-- Cobertura en 30 dias: 98,7% del valor. El 1,3% restante NO se descarta: entra con el
-- codigo sintetico '@SP' / '(SIN PROVEEDOR)' para que la suma del tablero cuadre con el POS.

-- ---------------------------------------------------------------------------
-- 1) HECHOS: venta por proveedor, dia y sede
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ventas_proveedor_dia (
  id bigserial PRIMARY KEY,
  empresa text NOT NULL,                       -- mercamio | mtodo | bogota
  fecha_dcto text NOT NULL,                    -- YYYYMMDD, mismo formato que ventas_item_diario
  id_co text NOT NULL,                         -- centro de operacion del POS (001, 002, ...)
  sede text,                                   -- resuelto contra ventas_item_sede_map (puede ser NULL)
  id_cricla1 text NOT NULL,                    -- codigo de proveedor; '@SP' = sin proveedor asignado
  proveedor text NOT NULL,                     -- nombre denormalizado (el NIT vive en proveedor_pos_catalogo)
  items integer NOT NULL DEFAULT 0,            -- items distintos vendidos de ese proveedor ese dia/sede
  unidades numeric(18,4) NOT NULL DEFAULT 0,   -- SUM(cmmovimiento_pdv.cantidad)

  -- ---- LAS TRES COLUMNAS DE PLATA -----------------------------------------
  -- Medido en vivo, con diferencia EXACTA de 0.00 sobre 5 dias completos:
  --     cmmovimiento_pdv.ven_netas = cmmovimiento_pdv.vlrtot_bru + cmmovimiento_pdv.imp_netos
  -- O sea ven_netas INCLUYE impuestos. Por eso aqui las columnas se nombran por lo que
  -- REALMENTE son, y no se repite el error de ventas_item_diario.venta_sin_impuesto_dia,
  -- que se llena con SUM(ven_netas) y por tanto si trae impuesto pese a su nombre.
  -- Se llevan las dos porque el ranking de proveedores cambia segun cual se use.
  venta_base numeric(18,4) NOT NULL DEFAULT 0,          -- SUM(vlrtot_bru): base gravable, SIN impuestos
  impuestos numeric(18,4) NOT NULL DEFAULT 0,           -- SUM(imp_netos): IVA + impoconsumo
  venta_con_impuesto numeric(18,4) NOT NULL DEFAULT 0,  -- SUM(ven_netas) = venta_base + impuestos

  -- Pasa-a-traves crudo. OJO: NO se cumple vlrtot_bru = precio_uni*cantidad - dscto_netos
  -- (medido: quedan ~70M sin explicar en un dia de mtodo). No lo uses para derivar la venta;
  -- esta aqui solo como dato informativo del POS.
  descuentos numeric(18,4) NOT NULL DEFAULT 0,          -- SUM(dscto_netos)

  source_load_id bigint REFERENCES ventas_item_cargas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Clave natural con columnas PLANAS a proposito: el upsert de sync-local-to-gcp.sh usa
-- ON CONFLICT (KEY) y un indice sobre expresiones (COALESCE) obliga a declarar CONFLICT[]
-- a mano, como paso con ventas_item_diario. Aqui se evita ese problema.
CREATE UNIQUE INDEX IF NOT EXISTS ventas_proveedor_dia_uq_natural
ON ventas_proveedor_dia (empresa, fecha_dcto, id_co, id_cricla1);

-- El tablero filtra por rango de fecha y agrupa por proveedor. Indice cubridor para que
-- la consulta de 30 dias se resuelva sin tocar el heap.
CREATE INDEX IF NOT EXISTS ventas_proveedor_dia_idx_fecha_cover
ON ventas_proveedor_dia (fecha_dcto, empresa, id_cricla1)
INCLUDE (unidades, venta_base, impuestos, venta_con_impuesto, items);

CREATE INDEX IF NOT EXISTS ventas_proveedor_dia_idx_prov
ON ventas_proveedor_dia (id_cricla1, fecha_dcto);

CREATE INDEX IF NOT EXISTS ventas_proveedor_dia_idx_sede
ON ventas_proveedor_dia (sede, fecha_dcto);

-- ---------------------------------------------------------------------------
-- 2) CATALOGO de proveedores (aqui vive el NIT)
-- ---------------------------------------------------------------------------
-- El NIT sale del POS solo PARCIALMENTE, y hay que leerlo con cuidado (todo verificado):
--   - La tabla que liga criterio con NIT existe, pero su nombre lleva SUFIJO POR EMPRESA:
--       mercamio -> public.nit_mmio     mtodo -> public.nit_mtodo     bogota -> NO EXISTE
--     (buscar "nit_mmio" dentro de mtodo da "no existe la relacion" y lleva a concluir, mal,
--     que no hay fuente. bogota hereda el NIT de mercamio porque los 1137 codigos son
--     identicos en las 3 empresas -- verificado, 0 discrepancias de nombre.)
--   - OJO con el centinela: de 1093 filas, 750 (68,6%) traen nit='99999999' junto con
--     proveedor='NO ASIGNADO'. Un COUNT(nit IS NOT NULL) ingenuo reporta 95,9% de cobertura
--     y es falso. Cobertura real: 341 de 1137 criterios (~30%), que ponderado por venta de
--     30 dias es 28,3% del total -- aunque el 73% de lo que falta son buckets INTERNOS
--     (MERCAMIO CARNES ROJAS, FRUVER, POLLOS, IMPORTADOS, GRANOS), que no son proveedores
--     externos y no tienen NIT propio. Sobre proveedores externos la cobertura es ~60%.
--   - items.id_terc esta poblado en 24 de 48.361 items -> inservible.
--   - public.terceros con ind_pro='1' tiene 3.078 proveedores con NIT pero NO hay llave
--     contra criterios_itm_1; solo se podria cruzar por nombre (posible y sin ambiguedad
--     medida, pero es una inferencia: se deja como paso aparte revisable, no automatico).
-- REGLA DE SOBREESCRITURA: el ETL escribe nit solo si esta vacio o si el valor vigente vino
-- del propio POS (nit_origen LIKE 'pos%'). Un NIT puesto a mano (nit_origen='manual') NUNCA
-- se pisa. Los codigos que desaparecen del POS se marcan activo=false en vez de borrarse,
-- para no perder el NIT ya trabajado ni romper los hechos historicos que apuntan a ese codigo.
CREATE TABLE IF NOT EXISTS proveedor_pos_catalogo (
  empresa text NOT NULL,
  id_cricla1 text NOT NULL,
  nombre text NOT NULL,
  nit text,                                    -- lo llena una persona o un cruce posterior; el ETL no lo toca
  nit_origen text,                             -- de donde salio el nit: 'manual', 'terceros', 'nit_mmio', ...
  activo boolean NOT NULL DEFAULT true,        -- false = ya no aparece en el POS
  primera_carga timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, id_cricla1)
);

CREATE INDEX IF NOT EXISTS proveedor_pos_catalogo_idx_nombre
ON proveedor_pos_catalogo (nombre);

CREATE INDEX IF NOT EXISTS proveedor_pos_catalogo_idx_nit
ON proveedor_pos_catalogo (nit) WHERE nit IS NOT NULL;

-- Fila sintetica del bucket sin proveedor, una por empresa. Debe existir siempre para que
-- un INNER JOIN del tablero no pierda ese 1,3% de la venta.
INSERT INTO proveedor_pos_catalogo (empresa, id_cricla1, nombre, nit_origen, activo)
VALUES
  ('mercamio', '@SP', '(SIN PROVEEDOR)', 'sintetico', true),
  ('mtodo',    '@SP', '(SIN PROVEEDOR)', 'sintetico', true),
  ('bogota',   '@SP', '(SIN PROVEEDOR)', 'sintetico', true)
ON CONFLICT (empresa, id_cricla1) DO NOTHING;
