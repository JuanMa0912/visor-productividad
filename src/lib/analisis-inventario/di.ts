/** Sin venta en el periodo: mismo centinela que inventario-x-item. */
export const NO_SALES_DI_VALUE = 999999;

export type DiMetricsInput = {
  inventoryUnits: number;
  inventoryValue: number;
  soldUnits: number;
  costOfSales: number;
  trackedDays: number;
};

export type DiMetrics = {
  diUnits: number;
  diValue: number;
};

/**
 * DI unidades = inv_cierre × dias / unidades_vendidas.
 * DI valor = inv_valor_cierre × dias / costo_de_venta.
 * Sin movimiento de venta/costo → NO_SALES; inventario cero → 0.
 */
export const calculateDiMetrics = (input: DiMetricsInput): DiMetrics => {
  const trackedDays = Math.max(0, Number(input.trackedDays) || 0);
  const inventoryUnits = Math.max(0, Number(input.inventoryUnits) || 0);
  const inventoryValue = Math.max(0, Number(input.inventoryValue) || 0);
  const soldUnits = Math.max(0, Number(input.soldUnits) || 0);
  const costOfSales = Math.max(0, Number(input.costOfSales) || 0);

  const diUnits =
    inventoryUnits <= 0
      ? 0
      : soldUnits <= 0 || trackedDays <= 0
        ? NO_SALES_DI_VALUE
        : (inventoryUnits * trackedDays) / soldUnits;

  const diValue =
    inventoryValue <= 0
      ? 0
      : costOfSales <= 0 || trackedDays <= 0
        ? NO_SALES_DI_VALUE
        : (inventoryValue * trackedDays) / costOfSales;

  return { diUnits, diValue };
};

export type DiRatesInput = {
  inventoryUnits: number;
  inventoryValue: number;
  /** Σ (unidades_i / dias_activos_i) sobre los ítems del grupo. Lo calcula el SQL. */
  unitsPerDay: number;
  /** Σ (costo_venta_i / dias_activos_i) sobre los ítems del grupo. */
  costPerDay: number;
  /**
   * Σ (uds_equivalentes_i / dias_activos_i): consumo por ENSAMBLE DE KIT (documento
   * `EK` del ERP), o sea la venta que el POS cobra en el codigo PADRE pero descuenta
   * del inventario del HIJO. Sin este termino el hijo sale con DI absurdo (medido:
   * HUEVO ROSADO AA und GRANEL, 38.180 dias contra 2,6 reales).
   * Opcional a proposito: si la BD todavia no tiene `rotacion_salidas_dia` ni las
   * columnas del snapshot, llega 0 y el resultado es identico al de antes del cambio.
   */
  equivUnitsPerDay?: number;
};

/**
 * DI a partir de TASAS DIARIAS ya sumadas por ítem: DI = inventario / (und/día).
 *
 * Por qué no basta `inventario × días / vendidas` (lo que hacía `calculateDiMetrics`
 * con `periodDays`): la tabla base es DENSA, emite una fila por ítem×sede×día
 * aunque el ítem todavía no exista en esa sede. Verificado en GCP el 2026-07-31:
 * 15.712 de 15.865 ítems de bogota/001 (99,0%) tienen fila los 30 días. Así que
 * un ítem que llegó a mitad de mes recibía el divisor del mes completo.
 *
 * Caso que lo destapó (005184 MORA COMUN*500g, bogota/001, julio 2026):
 * llegó el 28-jul, vendió 14 und en 3 días y cerró con 6 en inventario.
 *   antes:  6 × 30 / 14 = 12,86 d
 *   ahora:  6 /  (14/3) =  1,29 d   <- se agota en día y medio
 *
 * Sumar tasas es además la única forma ADITIVA correcta: cuando todos los ítems
 * comparten los mismos días, Σ Inv / Σ(V_i/D) = D·ΣInv / ΣV, o sea coincide con
 * la fórmula vieja. Solo difiere cuando las ventanas de exposición difieren, que
 * es exactamente el caso que hay que arreglar.
 *
 * Efecto medido al agregar (bogota/001, julio 2026): a nivel de ítem cambia
 * hasta 10x, pero a nivel de línea el movimiento es de -0,5% a -8,3% (el peor,
 * HIGIENE ORAL: 47,52 -> 43,58) y el total de la sede pasa de 18,95 a 18,77.
 * Es decir: esto arregla el dato del ítem, no reescribe el tablero.
 *
 * DENOMINADOR = DEMANDA. Desde `20260814_rotacion_periodo_std_demanda` el divisor
 * de `diUnits` es venta PDV + consumo por kit (`equivUnitsPerDay`), la misma
 * decision de negocio que toma `refresh_rotacion_item_periodo_std()` para el DIC
 * de /rotacion. `diValue` NO lleva ese termino: la correccion de kits solo esta
 * medida en unidades; ver la nota de mas abajo antes de "arreglarla".
 */
export const calculateDiFromRates = (input: DiRatesInput): DiMetrics => {
  const inventoryUnits = Math.max(0, Number(input.inventoryUnits) || 0);
  const inventoryValue = Math.max(0, Number(input.inventoryValue) || 0);
  const unitsPerDay = Math.max(0, Number(input.unitsPerDay) || 0);
  const costPerDay = Math.max(0, Number(input.costPerDay) || 0);
  const equivUnitsPerDay = Math.max(0, Number(input.equivUnitsPerDay) || 0);
  const demandPerDay = unitsPerDay + equivUnitsPerDay;

  const diUnits =
    inventoryUnits <= 0
      ? 0
      : demandPerDay <= 0
        ? NO_SALES_DI_VALUE
        : inventoryUnits / demandPerDay;

  /**
   * Por que `diValue` se queda con `costPerDay` a secas y no suma el costo de las
   * salidas por kit (`rotacion_salidas_dia.valor` existe):
   *  1. Nadie lo midio. La correccion de kits se reconcilio contra el ERP en
   *     UNIDADES (`cantidad_1`, signo verificado); de `costot` no hay ni la
   *     verificacion del signo.
   *  2. El ERP ya cobra ese costo una vez: al vender el kit, la venta PDV del
   *     PADRE trae su propio costo, que incluye el del hijo. Sumar el `EK` del
   *     hijo duplicaria pesos en cualquier total de linea, categoria o sede.
   *  3. `rotation`, la metrica canonica que publica /rotacion, es por unidades.
   *     Inventar aqui una version por costo seria desalinear, no alinear.
   */
  const diValue =
    inventoryValue <= 0
      ? 0
      : costPerDay <= 0
        ? NO_SALES_DI_VALUE
        : inventoryValue / costPerDay;

  return { diUnits, diValue };
};

export const formatDiDays = (value: number): string => {
  if (!Number.isFinite(value) || value >= NO_SALES_DI_VALUE) return "Sin venta";
  return `${(Math.round(value * 10) / 10).toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} d`;
};

/** Días calendario inclusive del rango consultado (misma base que rotación). */
export const calendarDaysInclusive = (start: string, end: string): number => {
  const from = new Date(`${start}T12:00:00`);
  const to = new Date(`${end}T12:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const diff = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return Math.max(0, diff + 1);
};

/** Bandas alineadas a inventario-x-item. */
export type DiBand = "alta" | "normal" | "revisar" | "sobrestock" | "sin-venta" | "cero";

export const resolveDiBand = (diDays: number): DiBand => {
  if (!Number.isFinite(diDays) || diDays >= NO_SALES_DI_VALUE) return "sin-venta";
  if (diDays <= 0) return "cero";
  if (diDays < 15) return "alta";
  if (diDays < 35) return "normal";
  if (diDays < 60) return "revisar";
  return "sobrestock";
};

export const DI_BAND_LABELS: Record<DiBand, string> = {
  alta: "< 15 d · rotación alta",
  normal: "15–35 d · normal",
  revisar: "35–60 d · revisar",
  sobrestock: "> 60 d · sobrestock",
  "sin-venta": "Sin venta",
  cero: "Sin inventario",
};

/** Colores de mapa de calor (fondo / texto). */
export const diHeatmapStyle = (
  diDays: number,
): { background: string; color: string } => {
  const band = resolveDiBand(diDays);
  switch (band) {
    case "alta":
      return { background: "rgba(16, 185, 129, 0.28)", color: "#065f46" };
    case "normal":
      return { background: "rgba(56, 189, 248, 0.28)", color: "#075985" };
    case "revisar":
      return { background: "rgba(251, 191, 36, 0.35)", color: "#92400e" };
    case "sobrestock":
      return { background: "rgba(244, 63, 94, 0.28)", color: "#9f1239" };
    case "cero":
      return { background: "#f8fafc", color: "#94a3b8" };
    case "sin-venta":
    default:
      return { background: "#e2e8f0", color: "#64748b" };
  }
};

export const diPillClassName = (diDays: number): string => {
  const band = resolveDiBand(diDays);
  switch (band) {
    case "alta":
      return "bg-emerald-50 text-emerald-700";
    case "normal":
      return "bg-sky-50 text-sky-700";
    case "revisar":
      return "bg-amber-100 text-amber-800";
    case "sobrestock":
      return "bg-rose-100 text-rose-700";
    case "cero":
      return "bg-slate-50 text-slate-400";
    case "sin-venta":
    default:
      return "bg-slate-100 text-slate-500";
  }
};
