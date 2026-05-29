import type { DailyProductivity, LineMetrics } from "@/types";

export type ApiResponse = {
  dailyData: DailyProductivity[];
  sedes: Array<{ id: string; name: string }>;
  error?: string;
};

export type DateRange = {
  start: string;
  end: string;
};

export type ViewExportHandle = {
  exportCsv: () => boolean;
  exportXlsx: () => Promise<boolean>;
};

export type ExportPayload = {
  pdfLines: LineMetrics[];
  selectedScopeLabel: string;
  selectedScopeId: string;
  dateRange: DateRange;
  dateRangeLabel: string;
  lineFilterLabel: string;
  comparisonDateRange: DateRange;
  comparisonDateRangeLabel: string;
  lineComparisons: Array<{
    id: string;
    name: string;
    currentSales: number;
    currentHours: number;
    currentSalesPerHour: number;
    previousSales: number;
    previousHours: number;
    previousSalesPerHour: number;
    salesDelta: number;
    salesDeltaPct: number | null;
  }>;
  lineSedeDetails: Array<{
    lineId: string;
    lineName: string;
    sedeId: string;
    sedeName: string;
    currentSales: number;
    currentHours: number;
    currentSalesPerHour: number;
    previousSales: number;
    previousHours: number;
    previousSalesPerHour: number;
    salesDelta: number;
    salesDeltaPct: number | null;
  }>;
  lineDailyDetails: Array<{
    periodLabel: "actual" | "mes anterior";
    date: string;
    lineId: string;
    lineName: string;
    sales: number;
    hours: number;
    salesPerHour: number;
  }>;
  lineSedeDailyDetails: Array<{
    periodLabel: "actual" | "mes anterior";
    date: string;
    sedeId: string;
    sedeName: string;
    lineId: string;
    lineName: string;
    sales: number;
    hours: number;
    salesPerHour: number;
  }>;
};
