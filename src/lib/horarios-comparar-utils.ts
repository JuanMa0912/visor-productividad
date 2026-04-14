import { normalizeKeySpaced, normalizePersonNameKey } from "@/lib/normalize";

export type PlanillaCompareInput = {
  planillaId: number;
  planillaSede: string;
  seccion: string;
  workedDate: string;
  employeeName: string;
  isRestDay: boolean;
  he1: string;
  hs1: string;
  he2: string;
  hs2: string;
};

export type AttendanceCompareInput = {
  workedDate: string;
  rawSede: string;
  employeeName: string;
  horaEntrada: string;
  horaIntermedia1: string;
  horaIntermedia2: string;
  horaSalida: string;
};

export type ComparisonRow = {
  workedDate: string;
  sede: string;
  employeeName: string;
  planillaId: number;
  seccion: string;
  isRestDay: boolean;
  plan: {
    he1: string;
    hs1: string;
    he2: string;
    hs2: string;
  };
  attendance: {
    horaEntrada: string;
    horaIntermedia1: string;
    horaIntermedia2: string;
    horaSalida: string;
  } | null;
  diffMin: {
    entrada: number | null;
    intermedia1: number | null;
    intermedia2: number | null;
    salida: number | null;
  };
  status: "cumplio" | "no_cumplio";
};

export function buildComparisonLookupKey(
  employeeName: string,
  workedDate: string,
  canonicalSedeKey: string,
) {
  return `${normalizePersonNameKey(employeeName)}|${workedDate}|${canonicalSedeKey}`;
}

export function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = String(value).trim();
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function diffMinutes(
  planned: string | null | undefined,
  actual: string | null | undefined,
): number | null {
  const p = parseTimeToMinutes(planned ?? "");
  const a = parseTimeToMinutes(actual ?? "");
  if (p === null || a === null) return null;
  return a - p;
}

type AttendanceTimeFields = Pick<
  AttendanceCompareInput,
  "horaEntrada" | "horaIntermedia1" | "horaIntermedia2" | "horaSalida"
>;

function hasAttendanceMarks(att: AttendanceTimeFields | null | undefined): boolean {
  if (!att) return false;
  return [att.horaEntrada, att.horaIntermedia1, att.horaIntermedia2, att.horaSalida].some(
    (v) => String(v ?? "").trim() !== "",
  );
}

/**
 * Tolerancia de retraso (min) para entrada e intermedias.
 * Diferencias mayores a este valor cuentan como No cumplio.
 */
export const HORARIOS_COMPARAR_TARDE_MAX_MIN = 10;

/**
 * Tolerancia de salida tarde (horas extra permitidas).
 * Hasta +120 min (2 horas) se considera Cumplio.
 */
export const HORARIOS_COMPARAR_SALIDA_EXTRA_MAX_MIN = 120;

function hasLateBeyondTolerance(diffMin: ComparisonRow["diffMin"]): boolean {
  const regularValues = [diffMin.entrada, diffMin.intermedia1, diffMin.intermedia2];
  for (const d of regularValues) {
    if (d !== null && d > HORARIOS_COMPARAR_TARDE_MAX_MIN) {
      return true;
    }
  }
  if (
    diffMin.salida !== null &&
    diffMin.salida > HORARIOS_COMPARAR_SALIDA_EXTRA_MAX_MIN
  ) {
    return true;
  }
  return false;
}

export function deriveHorariosCompararStatus(row: {
  planillaId: number;
  isRestDay: boolean;
  attendance: ComparisonRow["attendance"];
  diffMin: ComparisonRow["diffMin"];
}): ComparisonRow["status"] {
  const hasAtt = hasAttendanceMarks(row.attendance);

  if (row.planillaId === 0) {
    return hasAtt ? "cumplio" : "no_cumplio";
  }

  if (!hasAtt) {
    return "no_cumplio";
  }

  if (row.isRestDay) {
    return "cumplio";
  }

  if (hasLateBeyondTolerance(row.diffMin)) {
    return "no_cumplio";
  }

  return "cumplio";
}

export function mergePlanillaWithAttendance(
  planillaRows: PlanillaCompareInput[],
  attendanceByKey: Map<string, AttendanceCompareInput>,
  canonicalSedeKey: (rawSede: string) => string,
): ComparisonRow[] {
  const usedAttendanceKeys = new Set<string>();
  const out: ComparisonRow[] = [];

  for (const row of planillaRows) {
    const sedeCanon = canonicalSedeKey(row.planillaSede);
    const sedeKey = normalizeKeySpaced(sedeCanon);
    const lookupKey = buildComparisonLookupKey(
      row.employeeName,
      row.workedDate,
      sedeKey,
    );
    const att = attendanceByKey.get(lookupKey) ?? null;
    if (att) usedAttendanceKeys.add(lookupKey);

    const plan = {
      he1: row.he1 || "",
      hs1: row.hs1 || "",
      he2: row.he2 || "",
      hs2: row.hs2 || "",
    };

    if (row.isRestDay) {
      const attendance = att
        ? {
            horaEntrada: att.horaEntrada,
            horaIntermedia1: att.horaIntermedia1,
            horaIntermedia2: att.horaIntermedia2,
            horaSalida: att.horaSalida,
          }
        : null;
      const diffMin = {
        entrada: null,
        intermedia1: null,
        intermedia2: null,
        salida: null,
      } as const;
      const status = deriveHorariosCompararStatus({
        planillaId: row.planillaId,
        isRestDay: true,
        attendance,
        diffMin,
      });
      out.push({
        workedDate: row.workedDate,
        sede: sedeCanon,
        employeeName: row.employeeName,
        planillaId: row.planillaId,
        seccion: row.seccion,
        isRestDay: true,
        plan,
        attendance,
        diffMin: { ...diffMin },
        status,
      });
      continue;
    }

    const attendance = att
      ? {
          horaEntrada: att.horaEntrada,
          horaIntermedia1: att.horaIntermedia1,
          horaIntermedia2: att.horaIntermedia2,
          horaSalida: att.horaSalida,
        }
      : null;

    const diffMin = {
      entrada: diffMinutes(plan.he1, attendance?.horaEntrada),
      intermedia1: diffMinutes(plan.hs1, attendance?.horaIntermedia1),
      intermedia2: diffMinutes(plan.he2, attendance?.horaIntermedia2),
      salida: diffMinutes(plan.hs2, attendance?.horaSalida),
    };

    const status = deriveHorariosCompararStatus({
      planillaId: row.planillaId,
      isRestDay: false,
      attendance,
      diffMin,
    });

    out.push({
      workedDate: row.workedDate,
      sede: sedeCanon,
      employeeName: row.employeeName,
      planillaId: row.planillaId,
      seccion: row.seccion,
      isRestDay: false,
      plan,
      attendance,
      diffMin,
      status,
    });
  }

  for (const [key, att] of attendanceByKey) {
    if (usedAttendanceKeys.has(key)) continue;
    const sedeCanon = canonicalSedeKey(att.rawSede);
    const attendance = {
      horaEntrada: att.horaEntrada,
      horaIntermedia1: att.horaIntermedia1,
      horaIntermedia2: att.horaIntermedia2,
      horaSalida: att.horaSalida,
    };
    const diffMin = {
      entrada: null,
      intermedia1: null,
      intermedia2: null,
      salida: null,
    } as const;
    const status = deriveHorariosCompararStatus({
      planillaId: 0,
      isRestDay: false,
      attendance,
      diffMin,
    });
    out.push({
      workedDate: att.workedDate,
      sede: sedeCanon,
      employeeName: att.employeeName,
      planillaId: 0,
      seccion: "",
      isRestDay: false,
      plan: { he1: "", hs1: "", he2: "", hs2: "" },
      attendance,
      diffMin: { ...diffMin },
      status,
    });
  }

  out.sort((a, b) => {
    const d = a.workedDate.localeCompare(b.workedDate);
    if (d !== 0) return d;
    const s = a.sede.localeCompare(b.sede, "es");
    if (s !== 0) return s;
    return a.employeeName.localeCompare(b.employeeName, "es");
  });

  return out;
}
