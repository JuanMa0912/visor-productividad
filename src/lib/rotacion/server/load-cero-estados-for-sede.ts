import { getDbPool } from "@/lib/db";
import {
  DEFAULT_CERO_ROTACION_ESTADO,
  makeCeroRotacionEstadoKey,
  parseCeroRotacionEstado,
  parseRotacionSurtidoEstadoContext,
  type CeroRotacionEstado,
  type RotacionSurtidoEstadoContext,
} from "@/lib/rotacion/cero-estado";

const isMissingCeroEstadoTableError = (error: unknown) =>
  error instanceof Error &&
  /rotacion_cero_item_estado\b/i.test(error.message) &&
  /does not exist|no existe|undefined_table/i.test(error.message);

const isMissingContextColumnError = (error: unknown) =>
  error instanceof Error &&
  /rotacion_cero_item_estado\b/i.test(error.message) &&
  /context/i.test(error.message) &&
  /column|columna/i.test(error.message);

export type CeroEstadosForSede = {
  ceroEstadoByKey: Record<string, CeroRotacionEstado>;
  restockEstadoByKey: Record<string, CeroRotacionEstado>;
};

const mapEstadoRows = (
  rows: Array<{
    empresa: string;
    sede_id: string;
    item: string;
    estado: string;
    context: RotacionSurtidoEstadoContext;
  }>,
): CeroEstadosForSede => {
  const ceroEstadoByKey: Record<string, CeroRotacionEstado> = {};
  const restockEstadoByKey: Record<string, CeroRotacionEstado> = {};
  for (const row of rows) {
    const parsed = parseCeroRotacionEstado(row.estado);
    if (!parsed) continue;
    const key = makeCeroRotacionEstadoKey(row.empresa, row.sede_id, row.item);
    const ctx =
      parseRotacionSurtidoEstadoContext(
        typeof row.context === "string" ? row.context : undefined,
      ) ?? "cero";
    if (ctx === "restock") restockEstadoByKey[key] = parsed;
    else ceroEstadoByKey[key] = parsed;
  }
  return { ceroEstadoByKey, restockEstadoByKey };
};

/** Estados S.inventario para una sede (cero rotación y restock). */
export async function loadCeroEstadosForSede(
  empresa: string,
  sedeId: string,
): Promise<CeroEstadosForSede> {
  const pool = await getDbPool();
  try {
    const result = await pool.query<{
      empresa: string;
      sede_id: string;
      item: string;
      estado: string;
      context: RotacionSurtidoEstadoContext;
    }>(
      `
      SELECT empresa, sede_id, item, estado, context
      FROM rotacion_cero_item_estado
      WHERE empresa = $1 AND sede_id = $2
      `,
      [empresa, sedeId],
    );
    return mapEstadoRows(result.rows);
  } catch (error) {
    if (isMissingContextColumnError(error)) {
      const result = await pool.query<{
        empresa: string;
        sede_id: string;
        item: string;
        estado: string;
        context: RotacionSurtidoEstadoContext;
      }>(
        `
        SELECT empresa, sede_id, item, estado, 'cero'::text AS context
        FROM rotacion_cero_item_estado
        WHERE empresa = $1 AND sede_id = $2
        `,
        [empresa, sedeId],
      );
      return mapEstadoRows(result.rows);
    }
    if (isMissingCeroEstadoTableError(error)) {
      return {
        ceroEstadoByKey: {},
        restockEstadoByKey: {},
      };
    }
    throw error;
  }
}

export { DEFAULT_CERO_ROTACION_ESTADO };
