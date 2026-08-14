import type { PoolClient } from "pg";

/**
 * Anexo por cuenta (respaldo contable del F1007). Una fila por cada cuenta del
 * mapeo con movimiento en el periodo: debitos, creditos y movimiento
 * (debitos - creditos; ingresos en negativo, devoluciones en positivo), su
 * nombre (public.cuentas_contab) y el concepto DIAN.
 *
 * El total de "Suma de Movimiento" respalda el 1007: es igual a
 * -(Ingresos Brutos Recibidos) + (Devoluciones), sobre las mismas cuentas.
 *
 * Params: $1 = lapso inicio (YYYYMM), $2 = lapso fin, $3 = id_emp.
 */
const ANEXO_CUENTAS_QUERY = `
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
)
SELECT
    cc.cuenta                                              AS cuenta,
    COALESCE(MAX(TRIM(ct.descripcion)), '')                AS nombre_cuenta,
    COALESCE(SUM(c.valor_deb), 0)                          AS suma_debitos,
    COALESCE(SUM(c.valor_cre), 0)                          AS suma_creditos,
    COALESCE(SUM(c.valor_deb - c.valor_cre), 0)            AS suma_movimiento,
    cc.concepto                                            AS concepto
FROM cuentas_concepto cc
LEFT JOIN public.cgmovimiento_contable c
       ON TRIM(c.id_cuenta) = cc.cuenta AND c.id_emp = $3
      AND c.lapso_doc BETWEEN $1 AND $2
LEFT JOIN public.cuentas_contab ct ON TRIM(ct.codigo) = cc.cuenta
GROUP BY cc.cuenta, cc.concepto
HAVING COALESCE(SUM(c.valor_deb), 0) <> 0 OR COALESCE(SUM(c.valor_cre), 0) <> 0
ORDER BY cc.concepto, cc.cuenta
`;

export type AnexoCuentaRow = {
  cuenta: string;
  nombre_cuenta: string;
  suma_debitos: number;
  suma_creditos: number;
  suma_movimiento: number;
  concepto: string;
};

const toNum = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export const queryAnexoCuentas = async (
  client: PoolClient,
  startLapso: string,
  endLapso: string,
  idEmp: string,
): Promise<AnexoCuentaRow[]> => {
  const result = await client.query(ANEXO_CUENTAS_QUERY, [
    startLapso,
    endLapso,
    idEmp,
  ]);
  return result.rows.map((r) => ({
    cuenta: String(r.cuenta ?? "").trim(),
    nombre_cuenta: String(r.nombre_cuenta ?? "").trim(),
    suma_debitos: toNum(r.suma_debitos),
    suma_creditos: toNum(r.suma_creditos),
    suma_movimiento: toNum(r.suma_movimiento),
    concepto: String(r.concepto ?? "").trim(),
  }));
};
