import type { PoolClient, QueryResultRow } from "pg";

export const MTODO_MEDIOS_MAGNETICOS_COLUMNS = [
  { key: "Concepto", header: "Concepto" },
  { key: "Tipo Documento", header: "Tipo Documento" },
  { key: "Numero Identificacion", header: "Numero Identificacion" },
  { key: "DV", header: "DV" },
  { key: "Primer Apellido", header: "Primer Apellido" },
  { key: "Segundo Apellido", header: "Segundo Apellido" },
  { key: "Primer Nombre", header: "Primer Nombre" },
  { key: "Otros Nombres", header: "Otros Nombres" },
  { key: "Razon Social", header: "Razon Social" },
  { key: "Direccion", header: "Direccion" },
  { key: "Codigo Pais", header: "Codigo Pais" },
  { key: "Codigo Departamento", header: "Codigo Departamento" },
  { key: "Codigo Municipio", header: "Codigo Municipio" },
  { key: "Ingresos Brutos Recibidos", header: "Ingresos Brutos Recibidos" },
  {
    key: "Devoluciones Rebajas Descuentos",
    header: "Devoluciones Rebajas Descuentos",
  },
] as const;

export type MtodoMediosMagneticosRow = QueryResultRow & {
  [K in (typeof MTODO_MEDIOS_MAGNETICOS_COLUMNS)[number]["key"]]:
    | string
    | number
    | null;
};

export const buildYearLapsoRange = (year: number) => ({
  startLapso: `${year}01`,
  endLapso: `${year}12`,
});

// Medios magneticos F1007 para Comercializadora (mtodo), Mercamio (mio) y
// Merkmios (bgt). Misma estructura de ERP; se corre contra la BD de cada empresa.
// El id_emp NO es igual en todas (mtodo='01', mio='02', bgt='01'), por eso va
// parametrizado. Params: $1 = lapso inicio (YYYYMM), $2 = lapso fin, $3 = id_emp.
//
// Version "central" (mayor + PDV). Fuentes combinadas para desglosar los terceros
// que se identificaron con NIT en el POS, garantizando cuadre AL PESO contra el
// mayor:
//   1. MAYOR (cgmovimiento_contable): total por cuenta/concepto/tercero.
//   2. PDV (cmmovimiento_pdv): terceros individuales del POS con su NIT real
//      (formula: vlrtot_bru + vlrimpcon - bolsa en facturas; ABS(...) en notas).
//   3. AJUSTE DEL GENERICO: al generico del mayor (VC / 222222222222) se le resta
//      la suma de los individuales del PDV; el residual queda como CONSUMIDOR FINAL.
// El total reportado = mayor total (garantizado por construccion).
//
// Robustez de datos maestros:
//   - LEFT JOIN a terceros con DISTINCT ON (codigo): hay codigos con >1 registro
//     sucursal='00' (mismo NIT repetido); sin esto el join inflaria el ingreso.
//   - Consolidacion final por (Concepto, NIT): un mismo NIT real puede venir con
//     >1 codigo interno; la DIAN exige una fila por NIT + concepto.
//
// El alias de la columna de ingreso es "Ingresos Brutos Recibidos" para calzar con
// las keys que usa el armado del Excel (anchos, formato numerico, etc.).
const MTODO_MEDIOS_MAGNETICOS_QUERY = `
WITH cuentas_concepto (cuenta, concepto, tipo) AS (
    VALUES
        ('41352010','4001','I'),('41352012','4001','I'),('41352013','4001','I'),
        ('41352014','4001','I'),('41352021','4001','I'),('41352023','4001','I'),
        ('41352024','4001','I'),('41352030','4001','I'),
        ('42201005','4001','I'),('42950501','4001','I'),('42950503','4001','I'),
        ('42954500','4001','I'),('42955300','4001','I'),
        ('41752010','4001','D'),('41752012','4001','D'),('41752013','4001','D'),
        ('41752014','4001','D'),('41752021','4001','D'),('41752030','4001','D'),
        ('42201075','4001','D'),('42950575','4001','D'),
        ('42452000','4002','I'),('42950502','4002','I'),('42950504','4002','I'),
        ('42958100','4002','I'),('42108805','4002','I'),('42400500','4002','I'),
        ('42100500','4003','I'),('42104002','4003','I'),('42150500','4003','I'),
        ('42102000','4018','I'),('42102050','4018','I')
),
mayor_agrupado AS (
    SELECT
        TRIM(c.terc) AS id_terc,
        cc.concepto,
        SUM(CASE WHEN cc.tipo='I' THEN c.valor_cre - c.valor_deb ELSE 0 END) AS ingreso_bruto,
        SUM(CASE WHEN cc.tipo='D' THEN c.valor_deb - c.valor_cre ELSE 0 END) AS devolucion
    FROM public.cgmovimiento_contable c
    INNER JOIN cuentas_concepto cc ON TRIM(c.id_cuenta) = cc.cuenta
    WHERE c.id_emp = $3
      AND c.lapso_doc BETWEEN $1 AND $2
    GROUP BY TRIM(c.terc), cc.concepto
),
notas_pdv_tipos AS (
    SELECT DISTINCT TRIM(p.id_tipdoc_fc) AS codigo
    FROM public.cmmovimiento_pdv p
    WHERE p.id_emp_fc = $3 AND p.lapso_doc BETWEEN $1 AND $2
      AND TRIM(p.id_tipdoc_fc) IN (
            SELECT TRIM(codigo) FROM public.tipos_documentos WHERE descripcion ILIKE '%NOTA%')
),
items_bolsa AS (SELECT id_item FROM public.items WHERE TRIM(id_item) = '901093'),
pdv_individuales AS (
    SELECT TRIM(p.id_terc) AS id_terc, '4001'::varchar AS concepto,
        SUM(CASE WHEN nt.codigo IS NULL
             THEN p.vlrtot_bru + p.vlrimpcon1 + p.vlrimpcon2
                  - CASE WHEN b.id_item IS NOT NULL THEN p.vlrimpcon1 ELSE 0 END
             ELSE 0 END) AS ingreso_bruto,
        SUM(CASE WHEN nt.codigo IS NOT NULL
             THEN ABS(p.vlrtot_bru + p.dscto_netos) - ABS(p.dscto_netos)
                  + ABS(p.vlrimpcon1) + ABS(p.vlrimpcon2)
                  - ABS(CASE WHEN b.id_item IS NOT NULL THEN p.vlrimpcon1 ELSE 0 END)
             ELSE 0 END) AS devolucion
    FROM public.cmmovimiento_pdv p
    LEFT JOIN items_bolsa b      ON p.id_item = b.id_item
    LEFT JOIN notas_pdv_tipos nt ON TRIM(p.id_tipdoc_fc) = nt.codigo
    WHERE p.id_emp_fc = $3 AND p.lapso_doc BETWEEN $1 AND $2
      AND TRIM(p.id_terc) NOT IN ('222222222222', 'VC')
    GROUP BY TRIM(p.id_terc)
    HAVING SUM(CASE WHEN nt.codigo IS NULL
                THEN p.vlrtot_bru + p.vlrimpcon1 + p.vlrimpcon2
                     - CASE WHEN b.id_item IS NOT NULL THEN p.vlrimpcon1 ELSE 0 END
                ELSE 0 END) <> 0
        OR SUM(CASE WHEN nt.codigo IS NOT NULL
                THEN ABS(p.vlrtot_bru + p.dscto_netos) - ABS(p.dscto_netos)
                     + ABS(p.vlrimpcon1) + ABS(p.vlrimpcon2)
                     - ABS(CASE WHEN b.id_item IS NOT NULL THEN p.vlrimpcon1 ELSE 0 END)
                ELSE 0 END) <> 0
),
pdv_individuales_total AS (
    SELECT COALESCE(SUM(ingreso_bruto), 0) AS total_ingreso,
           COALESCE(SUM(devolucion), 0)    AS total_devolucion
    FROM pdv_individuales
),
mayor_ajustado AS (
    SELECT id_terc, concepto, ingreso_bruto, devolucion FROM mayor_agrupado
    WHERE NOT (concepto = '4001' AND TRIM(id_terc) IN ('222222222222', 'VC'))
    UNION ALL
    SELECT '222222222222' AS id_terc, '4001' AS concepto,
        COALESCE(SUM(m.ingreso_bruto), 0) - (SELECT total_ingreso FROM pdv_individuales_total) AS ingreso_bruto,
        COALESCE(SUM(m.devolucion), 0)    - (SELECT total_devolucion FROM pdv_individuales_total) AS devolucion
    FROM mayor_agrupado m
    WHERE m.concepto = '4001' AND TRIM(m.id_terc) IN ('222222222222', 'VC')
    UNION ALL
    SELECT id_terc, concepto, ingreso_bruto, devolucion FROM pdv_individuales
),
mayor_consolidado AS (
    SELECT id_terc, concepto, SUM(ingreso_bruto) AS ingreso_bruto, SUM(devolucion) AS devolucion
    FROM mayor_ajustado GROUP BY id_terc, concepto
),
reporte AS (
SELECT
    m.concepto AS "Concepto",
    CASE
        WHEN TRIM(m.id_terc) IN ('VC', '222222222222')
          OR LTRIM(TRIM(t.nit), '0') IN ('VC', '222222222222')
        THEN '43'
        WHEN TRIM(t.tipo_identifica) = '1' THEN '13'
        WHEN TRIM(t.tipo_identifica) = '2' THEN '31'
        WHEN TRIM(t.tipo_identifica) = '3' THEN '22'
        WHEN TRIM(t.tipo_identifica) = '4' THEN '12'
        WHEN TRIM(t.tipo_identifica) = '5' THEN '41'
        WHEN TRIM(t.tipo_identifica) = '6' THEN '21'
        WHEN TRIM(t.tipo_identifica) = '9' THEN '43'
        ELSE TRIM(t.tipo_identifica)
    END AS "Tipo Documento",
    CASE
        WHEN TRIM(m.id_terc) IN ('VC', '222222222222')
          OR TRIM(t.codigo)   IN ('VC')
          OR LTRIM(TRIM(t.nit), '0') IN ('VC')
        THEN '222222222222'
        ELSE LTRIM(TRIM(t.nit), '0')
    END AS "Numero Identificacion",
    CASE
        WHEN TRIM(m.id_terc) IN ('VC', '222222222222')
          OR LTRIM(TRIM(t.nit), '0') IN ('VC', '222222222222')
        THEN '1'
        ELSE TRIM(t.nit_dv)
    END AS "DV",
    TRIM(t.apellido1) AS "Primer Apellido",
    TRIM(t.apellido2) AS "Segundo Apellido",
    SPLIT_PART(TRIM(t.nombres), ' ', 1) AS "Primer Nombre",
    NULLIF(TRIM(REGEXP_REPLACE(TRIM(t.nombres), '^[^ ]+\\s*', '')), '') AS "Otros Nombres",
    CASE
        WHEN TRIM(m.id_terc) IN ('VC', '222222222222')
          OR LTRIM(TRIM(t.nit), '0') IN ('VC', '222222222222')
        THEN 'CONSUMIDOR FINAL'
        ELSE TRIM(t.descripcion)
    END AS "Razon Social",
    TRIM(t.direccion_1) AS "Direccion",
    CASE WHEN TRIM(t.pais_corresp)='770' THEN '169' ELSE TRIM(t.pais_corresp) END AS "Codigo Pais",
    TRIM(t.dpto_corresp) AS "Codigo Departamento",
    TRIM(t.ciudad_corresp) AS "Codigo Municipio",
    ROUND(m.ingreso_bruto)::bigint AS "Ingresos Brutos Recibidos",
    ROUND(m.devolucion)::bigint    AS "Devoluciones Rebajas Descuentos"
FROM mayor_consolidado m
LEFT JOIN (
    SELECT DISTINCT ON (TRIM(codigo))
        TRIM(codigo) AS codigo, nit, nit_dv, tipo_identifica,
        apellido1, apellido2, nombres, descripcion, direccion_1,
        pais_corresp, dpto_corresp, ciudad_corresp
    FROM public.terceros
    WHERE sucursal = '00'
    ORDER BY TRIM(codigo),
             (CASE WHEN TRIM(COALESCE(estado, '')) = 'X' THEN 1 ELSE 0 END),
             (CASE WHEN TRIM(COALESCE(nit_dv, '')) = '' THEN 1 ELSE 0 END),
             ctid
) t ON t.codigo = TRIM(m.id_terc)
WHERE m.ingreso_bruto <> 0 OR m.devolucion <> 0
)
SELECT
    "Concepto",
    MAX("Tipo Documento")                       AS "Tipo Documento",
    "Numero Identificacion",
    MAX("DV")                                   AS "DV",
    MAX("Primer Apellido")                      AS "Primer Apellido",
    MAX("Segundo Apellido")                     AS "Segundo Apellido",
    MAX("Primer Nombre")                        AS "Primer Nombre",
    MAX("Otros Nombres")                        AS "Otros Nombres",
    MAX("Razon Social")                         AS "Razon Social",
    MAX("Direccion")                            AS "Direccion",
    MAX("Codigo Pais")                          AS "Codigo Pais",
    MAX("Codigo Departamento")                  AS "Codigo Departamento",
    MAX("Codigo Municipio")                     AS "Codigo Municipio",
    SUM("Ingresos Brutos Recibidos")            AS "Ingresos Brutos Recibidos",
    SUM("Devoluciones Rebajas Descuentos")      AS "Devoluciones Rebajas Descuentos"
FROM reporte
GROUP BY "Concepto", "Numero Identificacion"
ORDER BY "Concepto", "Numero Identificacion"
`;

export const queryMtodoMediosMagneticos = async (
  client: PoolClient,
  startLapso: string,
  endLapso: string,
  idEmp: string,
) => {
  const result = await client.query<MtodoMediosMagneticosRow>(
    MTODO_MEDIOS_MAGNETICOS_QUERY,
    [startLapso, endLapso, idEmp],
  );
  return {
    rows: result.rows,
    startLapso,
    endLapso,
  };
};
