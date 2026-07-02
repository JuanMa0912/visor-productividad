"use client";

import { memo, type CSSProperties } from "react";
import { normalizeScheduleTime } from "@/lib/horarios/schedule-time";
import type {
  LunesSchedulePreset,
  LunesSchedulePresetKey,
} from "@/lib/horarios/lunes-schedule-presets";
import type { DayKey, DaySchedule, RowSchedule } from "./types";
import {
  DAY_ORDER,
  SCHEDULE_CELL_BORDER_CLASS,
  SCHEDULE_TIME_INPUT_BASE,
  TIME_SLOT_TD_CLASS,
  dayStartDividerClass,
  formatTimeForDisplay,
  handleScheduleEnterAdvance,
  sanitizeTimeTyping,
} from "./schedule-utils";

export type RowScheduleRowProps = {
  row: RowSchedule;
  rowIndex: number;
  employeeListId: string;
  canLunesPresetPerRow: boolean;
  lunesSyncActive: boolean;
  duplicateMessage?: string | null;
  onRowField: (
    rowIndex: number,
    field: keyof Pick<RowSchedule, "nombre" | "firma">,
    value: string,
  ) => void;
  onRowDayField: (
    rowIndex: number,
    day: DayKey,
    field: keyof DaySchedule,
    value: string,
    options?: { isBlur?: boolean },
  ) => void;
  onDescanso: (rowIndex: number, day: DayKey, checked: boolean) => void;
  onApplyLunesPreset: (
    rowIndex: number,
    presetKey: LunesSchedulePresetKey,
  ) => void;
  selectedLunesPreset: "" | LunesSchedulePresetKey;
  onClearLunesPresetChoice: (rowIndex: number) => void;
  schedulePresets: readonly LunesSchedulePreset[];
  presetSelectColStyle: CSSProperties;
  canRemoveRow: boolean;
  onRemoveRow: (rowIndex: number) => void;
};

function rowScheduleRowPropsAreEqual(
  prev: RowScheduleRowProps,
  next: RowScheduleRowProps,
) {
  return (
    prev.row === next.row &&
    prev.rowIndex === next.rowIndex &&
    prev.employeeListId === next.employeeListId &&
    prev.canLunesPresetPerRow === next.canLunesPresetPerRow &&
    prev.lunesSyncActive === next.lunesSyncActive &&
    prev.duplicateMessage === next.duplicateMessage &&
    prev.selectedLunesPreset === next.selectedLunesPreset &&
    prev.onRowField === next.onRowField &&
    prev.onRowDayField === next.onRowDayField &&
    prev.onDescanso === next.onDescanso &&
    prev.onApplyLunesPreset === next.onApplyLunesPreset &&
    prev.onClearLunesPresetChoice === next.onClearLunesPresetChoice &&
    prev.schedulePresets === next.schedulePresets &&
    prev.presetSelectColStyle === next.presetSelectColStyle &&
    prev.canRemoveRow === next.canRemoveRow &&
    prev.onRemoveRow === next.onRemoveRow
  );
}

export const RowScheduleRow = memo(
  ({
    row,
    rowIndex,
    employeeListId,
    canLunesPresetPerRow,
    lunesSyncActive,
    duplicateMessage,
    onRowField,
    onRowDayField,
    onDescanso,
    onApplyLunesPreset,
    selectedLunesPreset,
    onClearLunesPresetChoice,
    schedulePresets,
    presetSelectColStyle,
    canRemoveRow,
    onRemoveRow,
  }: RowScheduleRowProps) => (
    <tr className="odd:bg-white even:bg-slate-50/40">
      <td
        className={`${SCHEDULE_CELL_BORDER_CLASS} sticky left-0 z-10 bg-white px-1 py-0.5 align-top text-center text-[11px] leading-tight text-slate-600 shadow-[1px_0_0_0_rgb(203_213_225)] print:static print:bg-transparent print:shadow-none`}
      >
        <div className="flex flex-col items-center justify-center gap-0.5">
          <span>{rowIndex + 1}</span>
          {canRemoveRow ? (
            <button
              type="button"
              onClick={() => onRemoveRow(rowIndex)}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-rose-200 bg-rose-50 text-sm font-bold leading-none text-rose-600 transition hover:border-rose-300 hover:bg-rose-100 print:hidden"
              title={`Eliminar fila ${rowIndex + 1}`}
              aria-label={`Eliminar fila ${rowIndex + 1}`}
            >
              ×
            </button>
          ) : null}
        </div>
      </td>
      <td
        className={`${SCHEDULE_CELL_BORDER_CLASS} sticky left-11 z-10 bg-white align-top px-1.5 py-0.5 shadow-[1px_0_0_0_rgb(203_213_225)] print:static print:bg-transparent print:shadow-none`}
      >
        <input
          type="text"
          list={employeeListId}
          value={row.nombre}
          onChange={(e) =>
            onRowField(rowIndex, "nombre", e.target.value.trimStart())
          }
          placeholder="Escribir o seleccionar empleado"
          aria-invalid={Boolean(duplicateMessage)}
          className={`w-full min-w-70 rounded border px-1.5 py-0.5 text-[11px] leading-tight focus:outline-none focus:ring-1 print:hidden ${
            duplicateMessage
              ? "border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100"
              : "border-slate-200 focus:border-sky-300 focus:ring-sky-100"
          }`}
        />
        {duplicateMessage ? (
          <p className="mt-0.5 text-[10px] font-medium leading-tight text-rose-600 print:hidden">
            {duplicateMessage}
          </p>
        ) : null}
        <span className="hidden text-[8px] leading-tight text-slate-900 print:block print:leading-tight">
          {row.nombre}
        </span>
      </td>
      {canLunesPresetPerRow ? (
        <td
          className={`${SCHEDULE_CELL_BORDER_CLASS} align-top px-1.5 py-0.5 print:hidden`}
          style={presetSelectColStyle}
        >
          <select
            value={selectedLunesPreset}
            disabled={!lunesSyncActive}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") {
                onClearLunesPresetChoice(rowIndex);
                return;
              }
              // Aplica cualquier preset (originales 1/2/3 y los creados con
              // llave c-<timestamp>-<rand>); antes solo se aceptaban "1"|"2"|"3"
              // y los horarios personalizados quedaban en la lista sin llenar
              // las celdas del dia.
              onApplyLunesPreset(rowIndex, v);
            }}
            className="w-full max-w-none min-w-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] leading-tight text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            aria-label={`Aplicar horario predeterminado en fila ${rowIndex + 1}`}
          >
            <option value="">
              {lunesSyncActive ? "Horario…" : "Activa lunes"}
            </option>
            {schedulePresets.map((p) => (
              <option key={`row-${rowIndex}-preset-${p.key}`} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </td>
      ) : null}
      {DAY_ORDER.flatMap((day) => {
        const dayData = row.days[day];
        if (dayData.conDescanso) {
          return [
            <td
              key={`${rowIndex}-${day}-descanso`}
              colSpan={4}
              className={`${SCHEDULE_CELL_BORDER_CLASS} bg-amber-50/60 px-1 py-1 text-center ${dayStartDividerClass(day)}`}
            >
              <label className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-700">
                <input
                  type="checkbox"
                  checked={dayData.conDescanso}
                  onChange={(e) => onDescanso(rowIndex, day, e.target.checked)}
                  title="Marcar este dia como descanso para este empleado"
                  className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-200 print:hidden"
                />
                <span>Descanso</span>
              </label>
            </td>,
          ];
        }

        return (["he1", "hs1", "he2", "hs2"] as const).map((field) => (
          <td
            key={`${rowIndex}-${day}-${field}`}
            className={[TIME_SLOT_TD_CLASS, field === "he1" ? dayStartDividerClass(day) : ""]
              .filter(Boolean)
              .join(" ")}
          >
            {field === "he1" ? (
              <div className="relative min-w-0 print:static">
                <input
                  type="checkbox"
                  checked={dayData.conDescanso}
                  onChange={(e) => onDescanso(rowIndex, day, e.target.checked)}
                  title="Marcar este dia como descanso para este empleado"
                  className="absolute left-0 top-1/2 z-1 h-3.5 w-3.5 -translate-y-1/2 rounded border-slate-300 text-sky-600 focus:ring-sky-200 print:hidden"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="HH:mm"
                  title="24 h: horas 00 a 23, minutos 00 a 59. Ej: 08:30, 21:30 o 1430"
                  maxLength={5}
                  data-schedule-time="1"
                  value={(dayData[field] as string | undefined) ?? ""}
                  onChange={(e) =>
                    onRowDayField(
                      rowIndex,
                      day,
                      field,
                      sanitizeTimeTyping(e.target.value),
                    )
                  }
                  onKeyDown={handleScheduleEnterAdvance}
                  onBlur={(e) =>
                    onRowDayField(
                      rowIndex,
                      day,
                      field,
                      normalizeScheduleTime(e.target.value),
                      { isBlur: true },
                    )
                  }
                  className={`${SCHEDULE_TIME_INPUT_BASE} pl-5 pr-1.5`}
                />
                <span className="schedule-print-time hidden w-full pl-5 text-center text-[8px] leading-none text-slate-900 print:block print:w-full print:px-0.5 print:pl-0.5 tabular-nums">
                  {formatTimeForDisplay(dayData[field])}
                </span>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="HH:mm"
                  title="24 h: horas 00 a 23, minutos 00 a 59. Ej: 08:30, 21:30 o 1430"
                  maxLength={5}
                  data-schedule-time="1"
                  value={(dayData[field] as string | undefined) ?? ""}
                  onChange={(e) =>
                    onRowDayField(
                      rowIndex,
                      day,
                      field,
                      sanitizeTimeTyping(e.target.value),
                    )
                  }
                  onKeyDown={handleScheduleEnterAdvance}
                  onBlur={(e) =>
                    onRowDayField(
                      rowIndex,
                      day,
                      field,
                      normalizeScheduleTime(e.target.value),
                      { isBlur: true },
                    )
                  }
                  className={`${SCHEDULE_TIME_INPUT_BASE} px-1.5`}
                />
                <span className="schedule-print-time hidden w-full text-center text-[8px] leading-none text-slate-900 print:block print:tabular-nums">
                  {formatTimeForDisplay(dayData[field])}
                </span>
              </>
            )}
          </td>
        ));
      })}
      <td className={`${SCHEDULE_CELL_BORDER_CLASS} align-top px-1.5 py-0.5`}>
        <textarea
          value={row.firma}
          onChange={(e) => onRowField(rowIndex, "firma", e.target.value)}
          rows={2}
          className="min-h-9 w-full resize-y rounded border border-slate-200 px-1.5 py-0.5 text-[11px] leading-snug focus:border-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-100 print:hidden"
        />
        <span className="hidden text-[8px] leading-tight text-slate-900 print:block">
          {row.firma}
        </span>
      </td>
    </tr>
  ),
  rowScheduleRowPropsAreEqual,
);

RowScheduleRow.displayName = "RowScheduleRow";
