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

export interface OvertimeEmployee {
  employeeId?: string | null;
  employeeName: string;
  workedHours: number;
  isAbsence?: boolean;
  lineName?: string;
  sede?: string;
  department?: string;
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
}
