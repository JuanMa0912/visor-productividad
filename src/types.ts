export type Linekey =
  | "cajas"
  | "fruver"
  | "carnes"
  | "industria"
  | "pollo y pescado"
  | "asadero"
  | (string & {});

export interface LineMetrics {
  id: Linekey;
  name: string;
  sales: number;
  hours: number;
  hourlyRate: number;
}

export interface DailyProductivity {
  date: string;
  sede: string;
  lines: LineMetrics[];
}

export interface HourlyLineSales {
  lineId: Linekey;
  lineName: string;
  sales: number;
}

export interface HourSlot {
  hour: number;
  slotStartMinute: number;
  slotEndMinute: number;
  label: string;
  totalSales: number;
  employeesPresent: number;
  employeesByLine?: Record<string, number>;
  lines: HourlyLineSales[];
}

export type CashierAttendanceMatchMode = "cedula" | "id_texto" | "nombre";

export interface HourlyPersonSalesSlot {
  slotStartMinute: number;
  slotEndMinute: number;
  label: string;
  sales: number;
}

export interface HourlyPersonContribution {
  personKey: string;
  personId?: string | null;
  personName: string;
  firstMinuteOfDay?: number | null;
  lastMinuteOfDay?: number | null;
  hourlySales: HourlyPersonSalesSlot[];
  /** Total de ventas en un rango de fechas (sin desglose por hora). */
  periodTotalSales?: number;
  /** Cantidad de franjas con venta en el periodo (solo rango de fechas). */
  activeSlotsCount?: number;
  /**
   * Horas laboradas desde `asistencia_horas.total_laborado_horas` (depto cajas),
   * cuando hubo match por cedula o nombre con el cajero de ventas.
   */
  attendanceWorkedHours?: number | null;
  /** Como se cruzo con asistencia; null si no hubo match o no aplica. */
  attendanceMatchMode?: CashierAttendanceMatchMode | null;
  /** Cargo en asistencia cuando hubo match de horas con asistencia_horas. */
  personCargo?: string | null;
  /** Ventas por fecha para exploracion dia a dia. */
  dailySales?: Array<{
    date: string;
    sales: number;
    activeSlotsCount?: number;
  }>;
}

export interface OvertimeEmployee {
  employeeId?: string | null;
  employeeName: string;
  workedHours: number;
  isAbsence?: boolean;
  lineName?: string;
  sede?: string;
  department?: string;
  nomina?: string;
  employeeType?: string;
  marksCount?: number;
  role?: string;
  incident?: string;
  markIn?: string;
  markBreak1?: string;
  markBreak2?: string;
  markOut?: string;
  workedDate?: string;
}

export interface HourlyAnalysisData {
  date: string;
  scopeLabel: string;
  attendanceDateUsed?: string | null;
  salesDateUsed?: string | null;
  bucketMinutes?: number;
  hours: HourSlot[];
  overtimeEmployees?: OvertimeEmployee[];
  personContributions?: HourlyPersonContribution[];
  /** Cajeros agregados en varios dias; sin ventas por franja en personContributions. */
  personContributionsScope?: "single-day" | "date-range";
  personContributionsRange?: { start: string; end: string };
}
