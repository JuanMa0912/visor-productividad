import { normalizePersonNameKey } from "@/lib/normalize";
import { scheduleTimeToPostgresParam } from "@/lib/schedule-time";

export type HorarioDayKey =
  | "domingo"
  | "lunes"
  | "martes"
  | "miercoles"
  | "jueves"
  | "viernes"
  | "sabado";

export type HorarioDayScheduleInput = {
  he1?: string;
  hs1?: string;
  he2?: string;
  hs2?: string;
  conDescanso?: boolean;
};

export type HorarioRowScheduleInput = {
  nombre?: string;
  firma?: string;
  days?: Partial<Record<HorarioDayKey, HorarioDayScheduleInput>>;
};

/** Cliente devuelto por getDbPool().connect() (pg pool). */
export type HorarioSqlClient = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
};

export const HORARIO_DAY_ORDER: HorarioDayKey[] = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export const normalizePlanillaText = (value?: string) => (value ?? "").trim();

export function buildHorarioWorkedDateMap(
  start: string,
  end: string,
): Map<HorarioDayKey, string> {
  const map = new Map<HorarioDayKey, string>();
  if (!isDateKey(start) || !isDateKey(end) || start > end) {
    return map;
  }

  const cursor = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  while (cursor <= endDate) {
    const dayKey = HORARIO_DAY_ORDER[cursor.getDay()];
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    map.set(dayKey, `${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return map;
}

export function horarioRowHasContent(row: HorarioRowScheduleInput) {
  if (normalizePlanillaText(row.nombre) || normalizePlanillaText(row.firma)) {
    return true;
  }
  return HORARIO_DAY_ORDER.some((dayKey) => {
    const day = row.days?.[dayKey];
    return Boolean(
      day?.conDescanso ||
      normalizePlanillaText(day?.he1) ||
      normalizePlanillaText(day?.hs1) ||
      normalizePlanillaText(day?.he2) ||
      normalizePlanillaText(day?.hs2),
    );
  });
}

/** Validación de sede/fechas + empleados duplicados. */
export function validateHorarioPlanillaPayload(body: unknown):
  | { ok: false; error: string }
  | {
      ok: true;
      sede: string;
      seccion: string;
      fechaInicial: string;
      fechaFinal: string;
      mes: string;
      rows: HorarioRowScheduleInput[];
    } {
  const b =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const sede = normalizePlanillaText(
    typeof b.sede === "string" ? b.sede : undefined,
  );
  const seccion = normalizePlanillaText(
    typeof b.seccion === "string" ? b.seccion : undefined,
  );
  const fechaInicial = normalizePlanillaText(
    typeof b.fechaInicial === "string" ? b.fechaInicial : undefined,
  );
  const fechaFinal = normalizePlanillaText(
    typeof b.fechaFinal === "string" ? b.fechaFinal : undefined,
  );
  const mes = normalizePlanillaText(typeof b.mes === "string" ? b.mes : undefined);
  const rows = Array.isArray(b.rows)
    ? (b.rows as HorarioRowScheduleInput[])
    : [];

  if (!sede || !seccion) {
    return { ok: false, error: "Sede y seccion son obligatorias." };
  }
  if (
    (fechaInicial && !isDateKey(fechaInicial)) ||
    (fechaFinal && !isDateKey(fechaFinal))
  ) {
    return { ok: false, error: "Las fechas deben usar formato YYYY-MM-DD." };
  }
  if (fechaInicial && fechaFinal && fechaInicial > fechaFinal) {
    return {
      ok: false,
      error: "La fecha inicial no puede ser mayor que la final.",
    };
  }

  const seenEmployeeKeys = new Set<string>();
  for (const row of rows) {
    const rawName = normalizePlanillaText(row.nombre);
    if (!rawName) continue;
    const key = normalizePersonNameKey(rawName);
    if (!key) continue;
    if (seenEmployeeKeys.has(key)) {
      return {
        ok: false,
        error:
          "No puedes repetir el mismo empleado en mas de una fila. Revisa los nombres antes de guardar.",
      };
    }
    seenEmployeeKeys.add(key);
  }

  return {
    ok: true,
    sede,
    seccion,
    fechaInicial,
    fechaFinal,
    mes,
    rows,
  };
}

export function getPopulatedHorarioRows(rows: HorarioRowScheduleInput[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => horarioRowHasContent(row));
}

/** Inserta filas en horario_planilla_detalles (sin transacción propia). */
export async function insertHorarioPlanillaDetalles(
  client: HorarioSqlClient,
  planillaId: number,
  rows: HorarioRowScheduleInput[],
  workedDateMap: Map<HorarioDayKey, string>,
): Promise<void> {
  const populatedRows = getPopulatedHorarioRows(rows);

  for (const { row, index } of populatedRows) {
    for (const dayKey of HORARIO_DAY_ORDER) {
      const day = row.days?.[dayKey] ?? {};
      const isRestDay = Boolean(day.conDescanso);
      const he1 = scheduleTimeToPostgresParam(day.he1);
      const hs1 = scheduleTimeToPostgresParam(day.hs1);
      const he2 = scheduleTimeToPostgresParam(day.he2);
      const hs2 = scheduleTimeToPostgresParam(day.hs2);
      const employeeName = normalizePlanillaText(row.nombre);
      const employeeSignature = normalizePlanillaText(row.firma);
      const hasDayContent = Boolean(isRestDay || he1 || hs1 || he2 || hs2);

      if (!employeeName && !employeeSignature && !hasDayContent) {
        continue;
      }

      await client.query(
        `
        INSERT INTO horario_planilla_detalles (
          planilla_id,
          row_index,
          day_key,
          worked_date,
          employee_name,
          employee_signature,
          he1,
          hs1,
          he2,
          hs2,
          is_rest_day
        )
        VALUES (
          $1,
          $2,
          $3,
          NULLIF($4, '')::date,
          $5,
          NULLIF($6, ''),
          NULLIF($7, '')::time,
          NULLIF($8, '')::time,
          NULLIF($9, '')::time,
          NULLIF($10, '')::time,
          $11
        )
        `,
        [
          planillaId,
          index,
          dayKey,
          workedDateMap.get(dayKey) ?? "",
          employeeName,
          employeeSignature,
          he1 ?? "",
          hs1 ?? "",
          he2 ?? "",
          hs2 ?? "",
          isRestDay,
        ],
      );
    }
  }
}
