import { normalizeScheduleTime } from "@/lib/horarios/schedule-time";
import type { Ref } from "react";

export type PlanillaDayKey =
  | "domingo"
  | "lunes"
  | "martes"
  | "miercoles"
  | "jueves"
  | "viernes"
  | "sabado";

export type PlanillaDaySchedule = {
  he1: string;
  hs1: string;
  he2: string;
  hs2: string;
  conDescanso: boolean;
};

export type PlanillaRow = {
  nombre: string;
  firma: string;
  days: Record<PlanillaDayKey, PlanillaDaySchedule>;
};

type PlanillaPreviewProps = {
  rows: PlanillaRow[];
  sede: string;
  seccion: string;
  fechaInicial: string;
  fechaFinal: string;
  dayNumbersByKey: Partial<Record<PlanillaDayKey, string>>;
  /** Determina densidad y tipografia */
  mode: "jpg" | "print";
  /** Ref del wrapper (utilizado por html-to-image en modo jpg) */
  containerRef?: Ref<HTMLDivElement>;
  /** Clase adicional aplicada al wrapper externo */
  className?: string;
};

const DAY_ORDER: PlanillaDayKey[] = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

const FIRST_DAY_KEY = DAY_ORDER[0];

const dayStartDividerClass = (day: PlanillaDayKey) =>
  day === FIRST_DAY_KEY ? "" : "day-group-start";

const formatTimeForDisplay = (value?: string) => {
  const t = (value ?? "").trim();
  if (!t) return "";
  const normalized = normalizeScheduleTime(t);
  if (normalized) return normalized;
  if (/^\d{2}:\d{2}$/.test(t)) return t;
  return t.length <= 5 ? t : t.slice(0, 5);
};

const OUTER_BORDER = "border border-slate-300 print:border-slate-900";
const CELL_BORDER = "border border-slate-300 print:border-slate-900";

export function PlanillaPreview({
  rows,
  sede,
  seccion,
  fechaInicial,
  fechaFinal,
  dayNumbersByKey,
  mode,
  containerRef,
  className,
}: PlanillaPreviewProps) {
  const isCompact = mode === "jpg";
  const baseTextClass = isCompact ? "text-[9px]" : "text-[11px]";
  const headerTextClass = isCompact ? "text-[10px]" : "text-xs";
  const headerPadding = isCompact ? "px-2 py-1" : "px-3 py-2";
  const innerHeaderGap = isCompact
    ? "mt-1 grid-cols-4 gap-2 text-[10px] leading-tight"
    : "mt-2 grid-cols-4 gap-3 text-[11px]";
  const cellPadding = isCompact ? "px-1 py-1" : "px-1.5 py-1";
  const timeCellPadding = isCompact ? "px-0.5 py-1" : "px-1 py-1";

  return (
    <div
      ref={containerRef}
      className={`${isCompact ? "inline-block bg-white p-1 text-slate-900" : "w-full text-slate-900"} ${className ?? ""}`}
    >
      <div className={`${OUTER_BORDER} ${headerPadding}`}>
        <div className="grid grid-cols-[1fr_1fr_1fr] items-center border-b-2 border-slate-900 pb-1">
          <div
            className={`text-left ${headerTextClass} font-bold tracking-wide text-slate-900`}
          >
            MercaTodo
          </div>
          <div
            className={`text-center ${headerTextClass} font-bold tracking-wide text-slate-900`}
          >
            MERCAMIO S.A.
          </div>
          <div
            className={`text-right ${headerTextClass} font-bold uppercase tracking-wide text-slate-900`}
          >
            Planilla De Programacion Semanal De Horarios
          </div>
        </div>
        <div className={`grid ${innerHeaderGap} leading-tight`}>
          <div>
            <span className="font-semibold">SEDE:</span> {sede || "-"}
          </div>
          <div>
            <span className="font-semibold">SECCION:</span> {seccion || "-"}
          </div>
          <div>
            <span className="font-semibold">FECHA INICIAL:</span>{" "}
            {fechaInicial || "-"}
          </div>
          <div>
            <span className="font-semibold">FECHA FINAL:</span>{" "}
            {fechaFinal || "-"}
          </div>
        </div>
      </div>

      <div className={`mt-1 ${OUTER_BORDER}`}>
        <table
          className={`${isCompact ? "w-88rem" : "w-full"} table-fixed border-collapse ${baseTextClass} leading-tight`}
        >
          <thead>
            <tr className="bg-slate-100 text-slate-700">
              <th
                className={`${isCompact ? "w-8" : ""} ${CELL_BORDER} ${cellPadding} text-center`}
              >
                #
              </th>
              <th
                className={`${isCompact ? "w-44" : ""} ${CELL_BORDER} ${cellPadding} text-left`}
              >
                Nombre
              </th>
              {DAY_ORDER.map((day) => (
                <th
                  key={`preview-${day}`}
                  colSpan={4}
                  className={`${CELL_BORDER} ${cellPadding} text-center uppercase ${dayStartDividerClass(day)}`}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>{day}</span>
                    <span className="rounded-md bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
                      {dayNumbersByKey[day] ?? "--"}
                    </span>
                  </div>
                </th>
              ))}
              <th
                className={`${isCompact ? "w-40" : ""} ${CELL_BORDER} ${cellPadding} text-left`}
              >
                Firma empleado
              </th>
            </tr>
            <tr className="bg-white font-semibold text-slate-500">
              <th className={`${CELL_BORDER} ${timeCellPadding}`} />
              <th className={`${CELL_BORDER} ${timeCellPadding}`} />
              {DAY_ORDER.flatMap((day) =>
                (["he1", "hs1", "he2", "hs2"] as const).map((field) => (
                  <th
                    key={`preview-${day}-${field}`}
                    className={[
                      isCompact ? "w-12" : "",
                      CELL_BORDER,
                      `${timeCellPadding} text-center uppercase`,
                      field === "he1" ? dayStartDividerClass(day) : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {field === "he1" || field === "he2" ? "HE" : "HS"}
                  </th>
                )),
              )}
              <th className={`${CELL_BORDER} ${timeCellPadding}`} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={`preview-row-${rowIndex}`}
                className="odd:bg-white even:bg-slate-50/40"
              >
                <td
                  className={`${CELL_BORDER} ${cellPadding} text-center align-top text-slate-600`}
                >
                  {rowIndex + 1}
                </td>
                <td
                  className={`${CELL_BORDER} ${cellPadding} align-top text-slate-900 wrap-break-words`}
                >
                  {row.nombre || "--"}
                </td>
                {DAY_ORDER.flatMap((day) => {
                  const dayData = row.days[day];
                  if (dayData.conDescanso) {
                    return [
                      <td
                        key={`preview-${rowIndex}-${day}-descanso`}
                        colSpan={4}
                        className={`${CELL_BORDER} bg-amber-50/60 ${cellPadding} text-center font-semibold uppercase tracking-[0.06em] text-slate-700 ${dayStartDividerClass(day)}`}
                      >
                        Descanso
                      </td>,
                    ];
                  }

                  return (["he1", "hs1", "he2", "hs2"] as const).map(
                    (field) => (
                      <td
                        key={`preview-${rowIndex}-${day}-${field}`}
                        className={[
                          isCompact ? "w-12" : "",
                          CELL_BORDER,
                          `${timeCellPadding} text-center text-slate-700`,
                          field === "he1" ? dayStartDividerClass(day) : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {formatTimeForDisplay(dayData[field]) || "--"}
                      </td>
                    ),
                  );
                })}
                <td
                  className={`${CELL_BORDER} ${cellPadding} align-top text-slate-700 wrap-break-words`}
                >
                  {row.firma || "--"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
