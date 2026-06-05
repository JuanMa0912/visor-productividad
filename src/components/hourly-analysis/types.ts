import type { MutableRefObject, ReactNode } from "react";
import type { Sede } from "@/lib/shared/constants";
import type { HourlyAnalysisData } from "@/types";

export type HourlyAnalysisDashboardContext =
  | "productividad"
  | "jornada-extendida";

export type PersonBreakdownView = "individual" | "franjas";

export type OvertimeEmployee = NonNullable<
  HourlyAnalysisData["overtimeEmployees"]
>[number];

export type OvertimeSortField =
  | "fecha"
  | "horas"
  | "marcaciones"
  | "incidencia"
  | "estado"
  | "nomina"
  | "departamento";

export type OvertimeSortDirection = "asc" | "desc";

export type CashierSortField = "totalSales" | "workedHours" | "vtaHr";

export type HourlyAnalysisExportHandle = {
  exportCsv: () => boolean;
  exportXlsx: () => Promise<boolean>;
};

export interface HourlyAnalysisProps {
  availableDates: string[];
  availableSedes: Sede[];
  allowedLineIds?: string[];
  defaultDate?: string;
  defaultSede?: string;
  defaultLine?: string;
  sections?: Array<"map" | "overtime">;
  defaultSection?: "map" | "overtime";
  showTimeFilters?: boolean;
  showTopDateFilter?: boolean;
  showTopLineFilter?: boolean;
  showSedeFilters?: boolean;
  showDepartmentFilterInOvertime?: boolean;
  enableOvertimeDateRange?: boolean;
  alexConsistencyMode?: boolean;
  showComparison?: boolean;
  badgeLabel?: string;
  panelTitle?: string;
  panelDescription?: string;
  /** Contenido opcional alineado a la derecha del encabezado del panel (p. ej. un boton de accion). */
  headerActions?: ReactNode;
  showPersonBreakdown?: boolean;
  defaultPersonBreakdownView?: PersonBreakdownView;
  hidePersonBreakdownTabs?: boolean;
  dashboardContext?: HourlyAnalysisDashboardContext;
  alexTotalsOverride?: {
    moreThan72With2: number;
    moreThan92: number;
    oddMarks: number;
    absences: number;
  };
  exportRef?: MutableRefObject<HourlyAnalysisExportHandle | null>;
  /** Rango del filtro global (p. ej. productividad). Si hay mas de un dia, el ranking de cajeros se agrega en el servidor; el detalle por franja solo aplica con un dia. */
  cashierDateRange?: { start: string; end: string };
  /** Compara ventas totales por cajero: mes anterior (completo) vs mes en curso hasta la fecha fin del filtro. */
  cashierMonthComparison?: boolean;
  onCashierMonthComparisonToggle?: () => void;
  /** Cuando el bloque de cajeros termina de cargar tras un cambio de modo (p. ej. aviso al padre para quitar overlay). */
  onCashierViewReady?: () => void;
}
