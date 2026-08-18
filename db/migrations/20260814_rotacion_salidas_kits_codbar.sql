-- ============================================================================
-- Migracion: rotacion — salidas de inventario, composicion de kits y codigo de barras
-- ============================================================================
-- Aplica en LOCAL (232, produXdia) y en GCP. Idempotente.
--
-- POR QUE
-- -------
-- El DIC (dias de inventario) de /rotacion usa como denominador SOLO la venta del
-- POS (cmmovimiento_pdv). Medido el 2026-08-14 contra el 217: eso deja fuera el
-- documento `EK` = "ENSAMBLE DE KIT", que es el consumo real del hijo cuando se
-- vende un multipack, arroba o reempaque. En el lapso 202608 (items tipo 4, bodega
-- principal, mercamio) el EK salida son 671.060 unidades = +22% sobre la venta PDV
-- (RV = 3.016.228). Concentrado en pocos items, el error es brutal:
--   HUEVO ROSADO AA und GRANEL sede 001 (mtodo): DIC 38.180 dias -> 2,6 reales.
--   ARROZ BLANQUITA*500g sede 001:               DIC   233 dias -> 9,7 reales.
-- Ademas 886 filas de kits padre salen hoy en "Agotado" con DIC=0 mientras
-- vendieron 413.505 unidades en 31 dias.
--
-- POR QUE TABLAS APARTE Y NO COLUMNAS EN rotacion_base_item_dia_sede
-- ------------------------------------------------------------------
-- La base son 21,1 M de filas / 12 GB en el 232 (13 GB en GCP) y alimenta un matview
-- de 7,2 GB que se reconstruye CONCURRENTLY cada dia en un Cloud SQL de 8 GB. Tocarla
-- obliga a rebuild completo. Estas tres tablas se enganchan por LEFT JOIN sin tocar
-- ni la base ni el matview.
-- TAMANO MEDIDO (no estimado) el 2026-08-14, mercamio, dia 20260813:
--   rotacion_salidas_dia      5.217 filas/dia/empresa  (~15k/dia las 3)  = ~7% de las
--                             210.000 filas/dia de rotacion_base_item_dia_sede
--   rotacion_kit_composicion  1.163 filas/empresa (118 de nivel 2+, profundidad max 3)
--   rotacion_item_codbar     36.628 filas/empresa (34.499 GTIN, 2.129 PLU de granel)
--
-- ORIGEN (192.168.35.217, esquema del ERP)
-- ----------------------------------------
--   salidas      <- public.cmmovimiento_inventario  (doc_inv_tipo, ind_es, fecha_fc,
--                   id_local, id_item, cantidad_1 FIRMADO, costot)
--   composicion  <- public.kits  (id_cod_item_p, id_cod_item_c, cantidad, factor)
--   codbar       <- public.items.id_codbar  (canonico; ver README del ETL)
-- ============================================================================

SET statement_timeout = 0;
SET lock_timeout = '30s';

-- ── 1. HECHO: salidas/entradas de inventario que NO son venta POS ────────────
-- Se excluye `RV` (REMISION VENTAS PDV) a proposito: esa venta YA esta en
-- rotacion_base_item_dia_sede.cantidad_vendida. Incluirla duplicaria el denominador
-- y ademas dispararia el tamano (1.063.068 lineas por lapso solo de RV).
-- `unidades` va FIRMADO tal como viene del ERP: entradas positivas, salidas negativas
-- (verificado: ind_es=2 tiene 1.087.334 filas negativas y CERO positivas).
CREATE TABLE IF NOT EXISTS rotacion_salidas_dia (
    empresa       character varying(20)  NOT NULL,
    fecha_dia     date                   NOT NULL,
    sede          character varying(10)  NOT NULL,
    bodega_local  character varying(10)  NOT NULL,
    id_item       character varying(10)  NOT NULL,
    doc_inv_tipo  character varying(4)   NOT NULL,
    ind_es        smallint               NOT NULL,   -- 1 = entrada, 2 = salida
    unidades      numeric(18,4)          NOT NULL DEFAULT 0,
    valor         numeric(18,2)          NOT NULL DEFAULT 0,
    lineas        integer                NOT NULL DEFAULT 0,
    fecha_carga   timestamp without time zone NOT NULL DEFAULT now(),
    CONSTRAINT rotacion_salidas_dia_pkey
        PRIMARY KEY (empresa, fecha_dia, sede, bodega_local, id_item, doc_inv_tipo, ind_es),
    CONSTRAINT rotacion_salidas_dia_ind_es_check CHECK (ind_es IN (1, 2))
);

-- El PK ya cubre el join por (empresa, fecha_dia, sede, ...). Este indice es para
-- filtrar por tipo de documento sin escanear (ej. solo EK para el DIC de demanda).
CREATE INDEX IF NOT EXISTS rotacion_salidas_dia_idx_tipo_fecha
    ON rotacion_salidas_dia (doc_inv_tipo, fecha_dia DESC);

COMMENT ON TABLE rotacion_salidas_dia IS
  'Movimientos de inventario del POS que NO son venta PDV (RV excluido). Grano: empresa x dia x sede x bodega x item x tipo_doc x entrada/salida. `unidades` firmado (entradas +, salidas -). Alimenta el denominador del DIC.';
COMMENT ON COLUMN rotacion_salidas_dia.doc_inv_tipo IS
  'cmmovimiento_inventario.doc_inv_tipo. EK=ENSAMBLE DE KIT, ST=salida transferencia entre sedes, TB=transferencia bodegas internas, DC=desposte carnes, FS/Na/FN=averias, AA/AJ/IF=AJUSTES (no son demanda ni entrada real de mercancia).';

-- ── 2. DIMENSION: composicion de kits, cierre recursivo YA aplanado ──────────
-- Se guarda aplanado a proposito: la explosion tiene hasta 2 niveles reales
-- (PAPA TIPO ASADERO -> PAPA GRANEL -> PAPA CAPIRO) y resolverla en cada consulta
-- obligaria a un WITH RECURSIVE en el camino caliente del tablero.
-- multiplicador = producto de (cantidad * factor) a lo largo del camino.
CREATE TABLE IF NOT EXISTS rotacion_kit_composicion (
    empresa        character varying(20) NOT NULL,
    id_item_padre  character varying(10) NOT NULL,
    id_item_hijo   character varying(10) NOT NULL,
    multiplicador  numeric(20,6)         NOT NULL,
    nivel          smallint              NOT NULL DEFAULT 1,
    fecha_carga    timestamp without time zone NOT NULL DEFAULT now(),
    CONSTRAINT rotacion_kit_composicion_pkey
        PRIMARY KEY (empresa, id_item_padre, id_item_hijo)
);

CREATE INDEX IF NOT EXISTS rotacion_kit_composicion_idx_hijo
    ON rotacion_kit_composicion (empresa, id_item_hijo);

COMMENT ON TABLE rotacion_kit_composicion IS
  'Cierre recursivo de public.kits del POS (217), aplanado. ~1.160 pares por empresa. Sirve para EXPLICAR en el drill que padre se comio el stock; el consumo en si ya lo contabiliza el ERP como documento EK.';

-- ── 3. DIMENSION: un codigo de barras por item ───────────────────────────────
-- "El mas usado" NO es calculable: el POS resuelve alias->item al escanear y graba
-- el codigo maestro, no el escaneado (verificado: 168.069/168.069 lineas de
-- cmmovimiento_pdv.id_codbar son identicas a items.id_codbar, y ningun item muestra
-- mas de un codigo distinto en un dia). Se usa items.id_codbar, que es unico por item,
-- sin colisiones entre items, y esta garantizado dentro de cod_barras.
CREATE TABLE IF NOT EXISTS rotacion_item_codbar (
    empresa       character varying(20) NOT NULL,
    id_item       character varying(10) NOT NULL,
    codigo_barras character varying(20) NOT NULL,
    es_gtin       boolean               NOT NULL DEFAULT false,
    fecha_carga   timestamp without time zone NOT NULL DEFAULT now(),
    CONSTRAINT rotacion_item_codbar_pkey PRIMARY KEY (empresa, id_item)
);

COMMENT ON TABLE rotacion_item_codbar IS
  'items.id_codbar del POS por item tipo 4. ~36.6k filas por empresa.';
COMMENT ON COLUMN rotacion_item_codbar.es_gtin IS
  'true si el codigo son 12/13/14 digitos. FALSE en ~7,8% de los items con venta: son PLU de granel legitimos (PAPA SIN LAVAR*KILO GRANEL = "1", TOMATE CHONTO*KILO = "2"). En la UI titular la columna "Codigo", no "Codigo de barras", y no pasar los no-GTIN a un encoder EAN-13.';

ANALYZE rotacion_salidas_dia;
ANALYZE rotacion_kit_composicion;
ANALYZE rotacion_item_codbar;
