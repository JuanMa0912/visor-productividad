import { formatDateLabel } from "@/lib/shared/utils";
import type { DateRange } from "./types";

export const parseDateKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
};

export const toDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const dateLabelOptions: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

export const formatRangeLabel = (range: DateRange) => {
  if (!range.start || !range.end) return "";
  if (range.start === range.end) {
    return `${formatDateLabel(range.start, dateLabelOptions)}`;
  }
  return `${formatDateLabel(range.start, dateLabelOptions)} al ${formatDateLabel(range.end, dateLabelOptions)}`;
};

export const shiftMonthPreservingDay = (dateKey: string, months: number) => {
  const source = parseDateKey(dateKey);
  const targetYear = source.getFullYear();
  const targetMonthIndex = source.getMonth() + months;
  const candidate = new Date(targetYear, targetMonthIndex, 1);
  const lastDay = new Date(
    candidate.getFullYear(),
    candidate.getMonth() + 1,
    0,
  ).getDate();
  candidate.setDate(Math.min(source.getDate(), lastDay));
  return toDateKey(candidate);
};

export const getPreviousComparableRange = (range: DateRange): DateRange => {
  if (!range.start || !range.end) return range;
  return {
    start: shiftMonthPreservingDay(range.start, -1),
    end: shiftMonthPreservingDay(range.end, -1),
  };
};

export const clampChartDateRange = (range: DateRange): DateRange => {
  if (!range.start || !range.end) return range;
  const start = parseDateKey(range.start);
  const end = parseDateKey(range.end);
  if (start.getTime() <= end.getTime()) return range;
  return { start: range.end, end: range.end };
};
