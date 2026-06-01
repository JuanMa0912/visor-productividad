import type { InventarioSubcategoryKey } from "@/lib/inventario/x-item";

export type InventarioSummaryRow = {
  lineKey: string;
  lineLabel: string;
  linea: string;
  lineaN1Codigo: string | null;
  subcategory: InventarioSubcategoryKey;
  item: string;
  descripcion: string;
  unidad: string | null;
  inventoryUnits: number;
  inventoryValue: number;
  totalUnits: number;
  trackedDays: number;
  rotationDays: number;
  companyCount: number;
  sedeCount: number;
};

export type InventarioMatrixRow = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  lineKey: string;
  lineLabel: string;
  linea: string;
  lineaN1Codigo: string | null;
  subcategory: InventarioSubcategoryKey;
  item: string;
  descripcion: string;
  unidad: string | null;
  inventoryUnits: number;
  inventoryValue: number;
  totalUnits: number;
  trackedDays: number;
  rotationDays: number;
};

export type InventarioFilterCatalog = {
  companies: string[];
  sedes: Array<{
    empresa: string;
    sedeId: string;
    sedeName: string;
  }>;
};

export type InventarioApiResponse = {
  rows: InventarioSummaryRow[];
  matrixRows: InventarioMatrixRow[];
  filters: InventarioFilterCatalog;
  meta: {
    availableDate: string;
    availableDateStart?: string;
    availableDateEnd?: string;
    selectedDateStart?: string;
    selectedDateEnd?: string;
    sourceTable: string;
    selectedCompany?: string | null;
    selectedSede?: string | null;
  };
  message?: string;
  error?: string;
};

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  key?: string;
};

export type LineSelectionMode = "unset" | "all" | "specific";
export type MatrixSortDirection = "asc" | "desc";
export type MatrixSortField = "sede" | string;

export type MatrixCellValue = {
  inventoryUnits: number;
  /** Valor monetario del inventario (suma del COP $ por sede x item). */
  inventoryValue: number;
  soldUnits: number;
  diDays: number;
};

export type SummaryItemAgg = InventarioSummaryRow & {
  diWeightedNum: number;
  diWeightedDen: number;
  anyNoSalesDi: boolean;
};
