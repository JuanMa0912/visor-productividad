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

// Medios magneticos F1007 para Comercializadora (mtodo) y Mercamio (mio).
// Misma estructura de ERP en ambas bases (id_emp='01'); se corre contra la BD de
// cada empresa. Periodo parametrizado por lapso YYYYMM: $1 = inicio, $2 = fin.
// Merkmios (bgt) aun no tiene consulta estandar (se bloquea en el selector y la API).
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
    WHERE c.id_emp = '01'
      AND c.lapso_doc BETWEEN $1 AND $2
    GROUP BY TRIM(c.terc), cc.concepto
)
SELECT
    m.concepto AS "Concepto",
    CASE
        WHEN TRIM(t.codigo) IN ('VC')
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
        WHEN TRIM(t.codigo) IN ('VC') OR LTRIM(TRIM(t.nit), '0') IN ('VC')
        THEN '222222222222'
        ELSE LTRIM(TRIM(t.nit), '0')
    END AS "Numero Identificacion",
    CASE
        WHEN TRIM(t.codigo) IN ('VC')
          OR LTRIM(TRIM(t.nit), '0') IN ('VC', '222222222222')
        THEN '1'
        ELSE TRIM(t.nit_dv)
    END AS "DV",
    TRIM(t.apellido1) AS "Primer Apellido",
    TRIM(t.apellido2) AS "Segundo Apellido",
    SPLIT_PART(TRIM(t.nombres), ' ', 1) AS "Primer Nombre",
    NULLIF(TRIM(REGEXP_REPLACE(TRIM(t.nombres), '^[^ ]+\\s*', '')), '') AS "Otros Nombres",
    CASE
        WHEN TRIM(t.codigo) IN ('VC')
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
FROM mayor_agrupado m
LEFT JOIN public.terceros t ON TRIM(t.codigo) = m.id_terc AND t.sucursal = '00'
WHERE m.ingreso_bruto <> 0 OR m.devolucion <> 0
ORDER BY m.concepto, m.id_terc
`;

export const queryMtodoMediosMagneticos = async (
  client: PoolClient,
  startLapso: string,
  endLapso: string,
) => {
  const result = await client.query<MtodoMediosMagneticosRow>(
    MTODO_MEDIOS_MAGNETICOS_QUERY,
    [startLapso, endLapso],
  );
  return {
    rows: result.rows,
    startLapso,
    endLapso,
  };
};
