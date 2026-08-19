import type { PoolClient } from "pg";
import {
  MTODO_MEDIOS_MAGNETICOS_COLUMNS,
  queryMtodoMediosMagneticos,
} from "./mtodo-medios-magneticos";
import { queryAnexoCuentas } from "./anexo-cuentas";
import {
  FORMATO_1005_COLUMNS,
  FORMATO_1005_VALUE_KEYS,
  queryFormato1005,
  queryAnexo1005,
} from "./formato-1005";
import {
  FORMATO_1006_COLUMNS,
  FORMATO_1006_VALUE_KEYS,
  queryFormato1006,
  queryAnexo1006,
  type AnexoRow,
} from "./formato-1006";

export type FormatoId = "1007" | "1005" | "1006";

/** Tipo de parámetro manual (casilla) que pide cada formato, si aplica. */
export type ManualParam = "prorrateo" | "impoconsumo" | null;

export type FormatoDian = {
  id: FormatoId;
  label: string;
  sheetName: string;
  columns: readonly { key: string; header: string }[];
  valueKeys: readonly string[];
  /** parámetro manual (casilla) que admite el formato */
  manualParam: ManualParam;
  anexoTitle: string;
  /** encabezado de la última columna del anexo (agrupación de cuentas) */
  anexoGroupHeader: string;
  query: (
    client: PoolClient,
    startLapso: string,
    endLapso: string,
    idEmp: string,
    manual: number | null,
  ) => Promise<Record<string, unknown>[]>;
  anexo: (
    client: PoolClient,
    startLapso: string,
    endLapso: string,
    idEmp: string,
  ) => Promise<AnexoRow[]>;
};

// 1007: adapta su anexo (columna "concepto") al shape comun (campo "grupo").
const anexo1007 = async (
  client: PoolClient,
  startLapso: string,
  endLapso: string,
  idEmp: string,
): Promise<AnexoRow[]> => {
  const rows = await queryAnexoCuentas(client, startLapso, endLapso, idEmp);
  return rows.map((r) => ({
    cuenta: r.cuenta,
    nombre_cuenta: r.nombre_cuenta,
    suma_debitos: r.suma_debitos,
    suma_creditos: r.suma_creditos,
    suma_movimiento: r.suma_movimiento,
    grupo: r.concepto,
  }));
};

export const FORMATOS: Record<FormatoId, FormatoDian> = {
  "1007": {
    id: "1007",
    label: "1007 Ingresos recibidos",
    sheetName: "F1007",
    columns: MTODO_MEDIOS_MAGNETICOS_COLUMNS,
    valueKeys: ["Ingresos Brutos Recibidos", "Devoluciones Rebajas Descuentos"],
    manualParam: null,
    anexoTitle: "ANEXO 1007",
    anexoGroupHeader: "Concepto",
    query: (client, startLapso, endLapso, idEmp) =>
      queryMtodoMediosMagneticos(client, startLapso, endLapso, idEmp).then(
        (r) => r.rows as unknown as Record<string, unknown>[],
      ),
    anexo: anexo1007,
  },
  "1005": {
    id: "1005",
    label: "1005 IVA descontable",
    sheetName: "F1005",
    columns: FORMATO_1005_COLUMNS,
    valueKeys: FORMATO_1005_VALUE_KEYS,
    manualParam: "prorrateo",
    anexoTitle: "ANEXO 1005 IVA DESCONTABLE",
    anexoGroupHeader: "Rol",
    query: queryFormato1005,
    anexo: queryAnexo1005,
  },
  "1006": {
    id: "1006",
    label: "1006 IVA generado",
    sheetName: "F1006",
    columns: FORMATO_1006_COLUMNS,
    valueKeys: FORMATO_1006_VALUE_KEYS,
    manualParam: "impoconsumo",
    anexoTitle: "ANEXO 1006",
    anexoGroupHeader: "Columna",
    query: queryFormato1006,
    anexo: queryAnexo1006,
  },
};

export const isFormatoId = (v: string): v is FormatoId =>
  v === "1007" || v === "1005" || v === "1006";

export const parseFormatoParam = (raw: string | null): FormatoId => {
  const v = (raw ?? "").trim();
  return isFormatoId(v) ? v : "1007";
};
