export type ChecklistPeriod = {
  year: number;
  month: number;
};

const bogotaParts = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);

export const getChecklistPeriod = (date = new Date()): ChecklistPeriod => {
  const parts = bogotaParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return { year, month };
};

export const formatChecklistPeriod = (period: ChecklistPeriod): string => {
  const month = String(period.month).padStart(2, "0");
  return `${period.year}-${month}`;
};
