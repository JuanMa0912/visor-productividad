import {
  applyRowsQuickFilter,
  buildAbcdCategoryByItem,
  calculateDiSinceLastIngresoDays,
  calculateDuvDays,
  dateLabelOptions,
  displayRotationSedeName,
  formatCompanyLabel,
  formatPercent,
  formatRotationOneDecimal,
  isCeroRotacionExcludingNuevo,
  normalizeGroupZeroEstadoSetFilter,
  rotationMarginPct,
  type AbcdConfig,
  type DateRange,
  type GroupAbcdFilter,
  type GroupRowsQuickFilter,
  type RotationRow,
} from "./rotacion-preamble";
import {
  CERO_ROTACION_ESTADO_LABELS,
  CERO_ROTACION_ESTADO_VALUES,
  DEFAULT_CERO_ROTACION_ESTADO,
  makeCeroRotacionEstadoKey,
  type CeroRotacionEstado,
} from "@/lib/rotacion/cero-estado";
import { formatDateLabel } from "@/lib/shared/utils";

export type RotacionSedeRowGroup = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  rows: RotationRow[];
};

export type RotacionExportRow = {
  empresa: string;
  sede: string;
  item: string;
  categoria: string;
  ceroEstado: string;
  descripcion: string;
  ventaPeriodo: number;
  costoPeriodo: number;
  margenPorcentaje: string;
  invCierre: number;
  unidadesVendidas: number;
  unidad: string;
  valorInventario: number;
  rotacion: string;
  diDesdeIngreso: string;
  diaInventarioEfectivo: string;
  diaVentaEfectivo: string;
  duv: string;
  ultimoIngreso: string;
  fechaUltimaVenta: string;
};

export type RotacionExportGroup = {
  groupKey: string;
  isSurtidoTrackingTableView: boolean;
  surTrackingExportLabel: string;
  empresa: string;
  sede: string;
  rows: RotacionExportRow[];
};

export type BuildRotacionExportGroupsInput = {
  perSedeGroups: RotacionSedeRowGroup[];
  includedSedeValues: ReadonlySet<string>;
  /** Cuando la UI esta en vista consolidada multi-sede, los filtros de tabla viven bajo esta clave. */
  consolidatedFilterGroupKey: string | null;
  useConsolidatedTableFilters: boolean;
  perSedeBaseRowsByKey: ReadonlyMap<string, RotationRow[]>;
  rowsQuickFilterByGroup: Readonly<Record<string, GroupRowsQuickFilter>>;
  abcdFilterByGroup: Readonly<Record<string, GroupAbcdFilter>>;
  ventaHastaCapByGroup: Readonly<Record<string, number | undefined>>;
  invMinCapByGroup: Readonly<Record<string, number | undefined>>;
  ceroEstadoFilterByGroup: Readonly<Record<string, unknown>>;
  ceroEstadoByKey: Readonly<Record<string, CeroRotacionEstado>>;
  restockEstadoByKey: Readonly<Record<string, CeroRotacionEstado>>;
  abcdConfig: AbcdConfig;
  dateRange: DateRange;
  isAbcdFilterableRow: (row: RotationRow) => boolean;
  isNuevoItemInSelectedRange: (row: RotationRow) => boolean;
};

const resolveExportFilterGroupKey = (
  groupKey: string,
  input: Pick<
    BuildRotacionExportGroupsInput,
    "useConsolidatedTableFilters" | "consolidatedFilterGroupKey"
  >,
) =>
  input.useConsolidatedTableFilters && input.consolidatedFilterGroupKey
    ? input.consolidatedFilterGroupKey
    : groupKey;

export const buildRotacionExportGroups = (
  input: BuildRotacionExportGroupsInput,
): RotacionExportGroup[] =>
  input.perSedeGroups
    .filter((group) =>
      input.includedSedeValues.has(`${group.empresa}::${group.sedeId}`),
    )
    .map((group) => {
      const groupKey = `${group.empresa}-${group.sedeId}`;
      const filterGroupKey = resolveExportFilterGroupKey(groupKey, input);
      const rowFilter = input.rowsQuickFilterByGroup[filterGroupKey] ?? "none";
      const categoryFilter = input.abcdFilterByGroup[filterGroupKey] ?? "all";
      const ventaHastaCap =
        rowFilter === "venta_hasta" || rowFilter === "both"
          ? (input.ventaHastaCapByGroup[filterGroupKey] ?? null)
          : null;
      const isCeroTableContext =
        rowFilter === "cero_rotacion" || categoryFilter === "0";
      const isRestockCategoryView =
        categoryFilter === "S" ||
        categoryFilter === "R" ||
        categoryFilter === "N";
      const isSurtidoTrackingTableView =
        isCeroTableContext || isRestockCategoryView;
      const surTrackingExportLabel =
        isCeroTableContext && !isRestockCategoryView
          ? "Cero rotacion"
          : isRestockCategoryView && !isCeroTableContext
            ? "Restock"
            : "Seguimiento inventario";
      const estadoMapForFilter = isCeroTableContext
        ? input.ceroEstadoByKey
        : input.restockEstadoByKey;
      const quickFilteredRowsBeforeInvMin = applyRowsQuickFilter(
        group.rows,
        rowFilter,
        ventaHastaCap,
        input.dateRange,
      );
      const invMinCap = input.invMinCapByGroup[filterGroupKey] ?? null;
      const quickFilteredRows =
        invMinCap == null
          ? quickFilteredRowsBeforeInvMin
          : quickFilteredRowsBeforeInvMin.filter(
              (row) => row.inventoryUnits >= invMinCap,
            );
      const zeroEstadoSet = normalizeGroupZeroEstadoSetFilter(
        input.ceroEstadoFilterByGroup[filterGroupKey],
      );
      const filterSurtidoByEstadoMulti =
        isSurtidoTrackingTableView &&
        zeroEstadoSet.length < CERO_ROTACION_ESTADO_VALUES.length;
      const filteredRows = filterSurtidoByEstadoMulti
        ? quickFilteredRows.filter((row) => {
            const key = makeCeroRotacionEstadoKey(
              row.empresa,
              row.sedeId,
              row.item,
            );
            const estado =
              estadoMapForFilter[key] ?? DEFAULT_CERO_ROTACION_ESTADO;
            return zeroEstadoSet.includes(estado);
          })
        : quickFilteredRows;
      const sourceRowsForAbcd =
        input.perSedeBaseRowsByKey.get(groupKey) ?? group.rows;
      const sourceRowsForAbcdFilterable =
        sourceRowsForAbcd.filter(input.isAbcdFilterableRow);
      const categoryByItem = buildAbcdCategoryByItem(
        sourceRowsForAbcdFilterable,
        input.abcdConfig,
      );
      const categoryFilteredRows =
        categoryFilter === "all"
          ? filteredRows
          : categoryFilter === "0"
            ? filteredRows.filter((row) =>
                isCeroRotacionExcludingNuevo(row, input.dateRange),
              )
            : categoryFilter === "S" ||
                categoryFilter === "R" ||
                categoryFilter === "N"
              ? filteredRows.filter((row) =>
                  input.isNuevoItemInSelectedRange(row),
                )
              : Array.isArray(categoryFilter)
                ? filteredRows.filter((row) => {
                    const cat = categoryByItem.get(row.item);
                    return (
                      input.isAbcdFilterableRow(row) &&
                      cat !== undefined &&
                      categoryFilter.includes(cat)
                    );
                  })
                : filteredRows;
      const rows = categoryFilteredRows.map((row) => {
        const displayCategory = input.isNuevoItemInSelectedRange(row)
          ? "S"
          : isCeroRotacionExcludingNuevo(row, input.dateRange)
            ? "0"
            : (categoryByItem.get(row.item) ?? "D");
        const estadoKey = makeCeroRotacionEstadoKey(
          row.empresa,
          row.sedeId,
          row.item,
        );
        const estadoMapForRow = input.isNuevoItemInSelectedRange(row)
          ? input.restockEstadoByKey
          : input.ceroEstadoByKey;
        const surEstado =
          estadoMapForRow[estadoKey] ?? DEFAULT_CERO_ROTACION_ESTADO;
        const duvDays = calculateDuvDays(row.lastPurchaseDate);
        const diSinceIngresoDays = calculateDiSinceLastIngresoDays(
          row.lastMovementDate,
        );
        return {
          empresa: formatCompanyLabel(row.empresa),
          sede: displayRotationSedeName(row.sedeName),
          item: row.item,
          categoria: displayCategory,
          ceroEstado: CERO_ROTACION_ESTADO_LABELS[surEstado],
          descripcion: row.descripcion,
          ventaPeriodo: row.totalSales,
          costoPeriodo: row.totalCost,
          margenPorcentaje: formatPercent(
            rotationMarginPct(row.totalSales, row.totalCost),
          ),
          invCierre: row.inventoryUnits,
          unidadesVendidas: row.totalUnits,
          unidad: row.unidad ?? "",
          valorInventario: row.inventoryValue,
          rotacion: formatRotationOneDecimal(row.rotation),
          diDesdeIngreso:
            diSinceIngresoDays == null
              ? "Sin fecha"
              : diSinceIngresoDays.toLocaleString("es-CO"),
          diaInventarioEfectivo: row.trackedDays.toLocaleString("es-CO"),
          diaVentaEfectivo: row.salesEffectiveDays.toLocaleString("es-CO"),
          duv:
            duvDays == null
              ? "Sin fecha"
              : `${duvDays.toLocaleString("es-CO")} dias`,
          ultimoIngreso: row.lastMovementDate
            ? formatDateLabel(row.lastMovementDate, dateLabelOptions)
            : "Sin fecha de ingreso",
          fechaUltimaVenta: row.lastPurchaseDate
            ? formatDateLabel(row.lastPurchaseDate, dateLabelOptions)
            : "Sin fecha",
        };
      });
      return {
        groupKey,
        isSurtidoTrackingTableView,
        surTrackingExportLabel,
        empresa: formatCompanyLabel(group.empresa),
        sede: displayRotationSedeName(group.sedeName),
        rows,
      };
    })
    .filter((group) => group.rows.length > 0);
