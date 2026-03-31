"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CalendarDays,
  Filter,
  MapPin,
  PackageSearch,
  Store,
  TrendingDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { canAccessPortalSection } from "@/lib/portal-sections";
import { formatDateLabel } from "@/lib/utils";

type DateRange = {
  start: string;
  end: string;
};

type RotationRow = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  linea: string;
  lineaN1Codigo: string | null;
  item: string;
  descripcion: string;
  unidad: string | null;
  totalSales: number;
  inventoryUnits: number;
  inventoryValue: number;
  rotation: number;
  trackedDays: number;
  lastMovementDate: string | null;
  effectiveDays: number | null;
  status: "Sin movimiento" | "Baja rotacion" | "En seguimiento";
};

type RotationApiResponse = {
  rows: RotationRow[];
  stats: {
    evaluatedSedes: number;
    visibleItems: number;
    withoutMovement: number;
  };
  meta: {
    effectiveRange: DateRange;
    availableRange: { min: string; max: string };
    sourceTable: string;
    minInventoryValue: number | null;
  };
  message?: string;
  error?: string;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const dateLabelOptions: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

const parseDateKey = (dateKey: string) => new Date(`${dateKey}T12:00:00`);

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getCurrentMonthBounds = (baseDate?: string): DateRange => {
  const today = baseDate ? parseDateKey(baseDate) : new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12);
  return { start: toDateKey(monthStart), end: toDateKey(monthEnd) };
};

const sanitizeNumericInput = (value: string) => value.replace(/\D/g, "");

const normalizeDateRange = (
  current: DateRange,
  changedField: "start" | "end",
): DateRange => {
  const start = current.start;
  const end = current.end;

  if (!start && !end) return current;
  if (!start) return { start: end, end };
  if (!end) return { start, end: start };
  if (start <= end) return { start, end };

  return changedField === "start"
    ? { start, end: start }
    : { start: end, end };
};

const countInclusiveDays = (range: DateRange) => {
  if (!range.start || !range.end) return 0;
  const start = parseDateKey(range.start);
  const end = parseDateKey(range.end);
  return Math.floor((end.getTime() - start.getTime()) / DAY_IN_MS) + 1;
};

const formatRangeLabel = (range: DateRange) => {
  if (!range.start || !range.end) return "Sin rango";
  if (range.start === range.end) {
    return `${formatDateLabel(range.start, dateLabelOptions)}`;
  }
  return `${formatDateLabel(range.start, dateLabelOptions)} al ${formatDateLabel(
    range.end,
    dateLabelOptions,
  )}`;
};

const formatPrice = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);

const getStatusBadgeClassName = (status: RotationRow["status"]) => {
  switch (status) {
    case "Sin movimiento":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "Baja rotacion":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
};

const buildRowsBySede = (rows: RotationRow[]) => {
  const grouped = new Map<
    string,
    {
      empresa: string;
      sedeId: string;
      sedeName: string;
      rows: RotationRow[];
    }
  >();

  rows.forEach((row) => {
    const key = `${row.empresa}::${row.sedeId}::${row.sedeName}`;
    const current = grouped.get(key) ?? {
      empresa: row.empresa,
      sedeId: row.sedeId,
      sedeName: row.sedeName,
      rows: [],
    };
    current.rows.push(row);
    grouped.set(key, current);
  });

  return Array.from(grouped.values());
};

const COMPANY_LABELS: Record<string, string> = {
  mercamio: "Mercamio",
  mtodo: "Mercatodo",
  bogota: "Merkmios",
};

const formatCompanyLabel = (value: string) =>
  COMPANY_LABELS[value] ??
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

type StatCardProps = {
  icon: React.ElementType;
  label: string;
  value: string;
  description: string;
  iconClassName: string;
};

const StatCard = ({
  icon: Icon,
  label,
  value,
  description,
  iconClassName,
}: StatCardProps) => (
  <Card className="border-slate-200/80 bg-white/95 shadow-[0_22px_45px_-40px_rgba(15,23,42,0.45)]">
    <CardContent className="flex items-start justify-between gap-4 px-5 py-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
          {label}
        </p>
        <p className="mt-2 text-3xl font-black text-slate-900">{value}</p>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
      </div>
      <div className={`rounded-2xl p-3 ${iconClassName}`}>
        <Icon className="h-5 w-5" />
      </div>
    </CardContent>
  </Card>
);

type SelectFieldProps = {
  icon: React.ElementType;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  allLabel: string;
  accentClassName: string;
};

const FilterFieldLabel = ({
  icon: Icon,
  label,
  accentClassName,
}: {
  icon: React.ElementType;
  label: string;
  accentClassName: string;
}) => (
  <span
    className={`mb-2 flex min-h-[2.75rem] items-start gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] leading-4 ${accentClassName}`}
  >
    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
    <span className="block">{label}</span>
  </span>
);

const FilterSelectField = ({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  allLabel,
  accentClassName,
}: SelectFieldProps) => (
  <label className="block">
    <FilterFieldLabel icon={Icon} label={label} accentClassName={accentClassName} />
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900 outline-none transition-all focus:border-amber-300 focus:bg-white focus:ring-4 focus:ring-amber-100"
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

export default function RotacionPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [selectedSede, setSelectedSede] = useState("");
  const [valueThreshold, setValueThreshold] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>({ start: "", end: "" });
  const [availableRange, setAvailableRange] = useState<DateRange>({
    start: "",
    end: "",
  });
  const [rows, setRows] = useState<RotationRow[]>([]);
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const loadUser = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          signal: controller.signal,
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) return;

        const payload = (await response.json()) as {
          user?: { role?: string; allowedDashboards?: string[] | null };
        };
        const isAdmin = payload.user?.role === "admin";
        if (
          !isAdmin &&
          !canAccessPortalSection(payload.user?.allowedDashboards, "producto")
        ) {
          router.replace("/secciones");
          return;
        }

        if (isMounted) setReady(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };

    void loadUser();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [router]);

  useEffect(() => {
    if (!ready) return;

    const controller = new AbortController();

    const loadRotation = async () => {
      setIsLoadingData(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (dateRange.start && dateRange.end) {
          params.set("start", dateRange.start);
          params.set("end", dateRange.end);
        }
        if (valueThreshold) {
          params.set("minInventoryValue", valueThreshold);
        }

        const response = await fetch(
          `/api/rotacion${params.size > 0 ? `?${params.toString()}` : ""}`,
          {
            signal: controller.signal,
            cache: "no-store",
          },
        );

        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.status === 403) {
          router.replace("/secciones");
          return;
        }

        const payload = (await response.json()) as RotationApiResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? "No fue posible consultar la rotacion.");
        }

        setRows(payload.rows ?? []);
        setApiMessage(payload.message ?? null);

        if (payload.meta?.availableRange) {
          setAvailableRange({
            start: payload.meta.availableRange.min,
            end: payload.meta.availableRange.max,
          });
        }

        if (
          payload.meta?.effectiveRange &&
          (!dateRange.start ||
            !dateRange.end ||
            dateRange.start !== payload.meta.effectiveRange.start ||
            dateRange.end !== payload.meta.effectiveRange.end)
        ) {
          setDateRange(payload.meta.effectiveRange);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setRows([]);
        setError(err instanceof Error ? err.message : "Error consultando rotacion.");
      } finally {
        setIsLoadingData(false);
      }
    };

    void loadRotation();
    return () => controller.abort();
  }, [dateRange.end, dateRange.start, ready, router, valueThreshold]);

  const daysConsulted = useMemo(() => countInclusiveDays(dateRange), [dateRange]);
  const formattedRange = useMemo(() => formatRangeLabel(dateRange), [dateRange]);
  const parsedThreshold = valueThreshold ? Number(valueThreshold) : 0;
  const companyOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.empresa)))
        .sort((a, b) => formatCompanyLabel(a).localeCompare(formatCompanyLabel(b), "es"))
        .map((empresa) => ({
          value: empresa,
          label: formatCompanyLabel(empresa),
        })),
    [rows],
  );

  const sedeOptions = useMemo(() => {
    const scopedRows = selectedCompany
      ? rows.filter((row) => row.empresa === selectedCompany)
      : rows;

    return Array.from(
      new Map(
        scopedRows.map((row) => [row.sedeId, { value: row.sedeId, label: row.sedeName }]),
      ).values(),
    ).sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [rows, selectedCompany]);

  useEffect(() => {
    if (!selectedSede) return;
    if (!sedeOptions.some((option) => option.value === selectedSede)) {
      setSelectedSede("");
    }
  }, [selectedSede, sedeOptions]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (selectedCompany && row.empresa !== selectedCompany) return false;
        if (selectedSede && row.sedeId !== selectedSede) return false;
        return true;
      }),
    [rows, selectedCompany, selectedSede],
  );

  const rowsBySede = useMemo(() => buildRowsBySede(filteredRows), [filteredRows]);
  const visibleStats = useMemo(
    () => ({
      evaluatedSedes: new Set(filteredRows.map((row) => row.sedeName)).size,
      visibleItems: filteredRows.length,
      withoutMovement: filteredRows.filter((row) => row.status === "Sin movimiento").length,
    }),
    [filteredRows],
  );

  const handleValueChange = (value: string) => {
    setValueThreshold(sanitizeNumericInput(value));
  };

  const handleStartDateChange = (value: string) => {
    if (!value) return;
    setDateRange((current) =>
      normalizeDateRange({ start: value, end: current.end }, "start"),
    );
  };

  const handleEndDateChange = (value: string) => {
    if (!value) return;
    setDateRange((current) =>
      normalizeDateRange({ start: current.start, end: value }, "end"),
    );
  };

  const handleCurrentMonthClick = () => {
    setDateRange(getCurrentMonthBounds(availableRange.end || undefined));
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-3xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando rotacion...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-foreground sm:py-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <Card className="overflow-hidden border-amber-200/80 bg-linear-to-br from-white via-amber-50/70 to-orange-50 shadow-[0_28px_70px_-45px_rgba(245,158,11,0.55)]">
          <CardContent className="px-6 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-3xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-700">
                  Producto
                </p>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                  Rotacion
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-[15px]">
                  Esta vista toma datos reales desde la base diaria para revisar la
                  rotacion del inventario por sede, detectar productos con salida
                  lenta y ubicar referencias detenidas dentro del rango consultado.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  asChild
                  variant="outline"
                  className="rounded-full border-slate-200 bg-white/90 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 hover:bg-slate-50"
                >
                  <Link href="/productividad">
                    <ArrowLeft className="h-4 w-4" />
                    Volver a producto
                  </Link>
                </Button>
                <Button
                  asChild
                  className="rounded-full bg-amber-600 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-white hover:bg-amber-700"
                >
                  <Link href="/secciones">Cambiar seccion</Link>
                </Button>
              </div>
            </div>

            <div className="mt-6 rounded-3xl border border-amber-200/80 bg-white/85 p-4 shadow-[0_18px_35px_-30px_rgba(245,158,11,0.35)] sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-amber-200 bg-amber-100 text-amber-900">
                  Datos reales
                </Badge>
                <Badge className="border-sky-200 bg-sky-50 text-sky-700">
                  Fuente diaria
                </Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                La pantalla ya esta conectada a{" "}
                <span className="font-semibold text-slate-800">
                  rotacion_base_item_dia_sede
                </span>{" "}
                y conserva los filtros principales para seguir ajustando la lectura
                visual sobre una base real.
              </p>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.32fr)_minmax(320px,1fr)]">
          <Card className="border-slate-200/80 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <Filter className="h-5 w-5 text-amber-600" />
                Filtros principales
              </CardTitle>
              <CardDescription>
                Selecciona empresa, sede y un umbral numerico para enfocar la
                lectura sin perder el contexto del rango actual.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(15rem,1.08fr)]">
                <FilterSelectField
                  icon={Building2}
                  label="Empresa"
                  value={selectedCompany}
                  options={companyOptions}
                  onChange={(value) => {
                    setSelectedCompany(value);
                    setSelectedSede("");
                  }}
                  allLabel="Todas las empresas"
                  accentClassName="text-indigo-700"
                />
                <FilterSelectField
                  icon={MapPin}
                  label="Sede"
                  value={selectedSede}
                  options={sedeOptions}
                  onChange={setSelectedSede}
                  allLabel="Todas las sedes"
                  accentClassName="text-sky-700"
                />
                <label className="block md:col-span-2 xl:col-span-1">
                  <FilterFieldLabel
                    icon={Filter}
                    label="Valor inventario minimo"
                    accentClassName="text-slate-500"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={valueThreshold}
                    onChange={(event) => handleValueChange(event.target.value)}
                    placeholder="Ejemplo 15000"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-amber-300 focus:bg-white focus:ring-4 focus:ring-amber-100"
                  />
                </label>
              </div>
              <p className="text-xs leading-5 text-slate-500">
                Solo numeros enteros, sin puntos ni comas. El filtro usa el valor de
                inventario y nunca acepta negativos.
              </p>
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">
                  {selectedCompany
                    ? formatCompanyLabel(selectedCompany)
                    : "Todas las empresas"}
                </Badge>
                <Badge className="border-sky-200 bg-sky-50 text-sky-700">
                  {selectedSede
                    ? sedeOptions.find((option) => option.value === selectedSede)?.label ??
                      selectedSede
                    : "Todas las sedes"}
                </Badge>
                <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                  {valueThreshold
                    ? `Min. ${formatPrice(parsedThreshold)}`
                    : "Sin filtro de valor"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <CalendarDays className="h-5 w-5 text-amber-600" />
                Periodo de consulta
              </CardTitle>
              <CardDescription>
                El rango se apoya en la fecha maxima disponible en la base y puedes
                moverlo manualmente cuando necesites revisar otro corte.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  onClick={handleCurrentMonthClick}
                  className="rounded-full bg-slate-900 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-white hover:bg-slate-800"
                >
                  Evaluacion mes
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                    {daysConsulted} {daysConsulted === 1 ? "dia" : "dias"} consultados
                  </Badge>
                  <Badge className="border-slate-200 bg-slate-50 text-slate-700">
                    {formattedRange}
                  </Badge>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Desde
                  </span>
                  <input
                    type="date"
                    value={dateRange.start}
                    min={availableRange.start || undefined}
                    max={availableRange.end || undefined}
                    onChange={(event) => handleStartDateChange(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition-all focus:border-amber-300 focus:bg-white focus:ring-4 focus:ring-amber-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Hasta
                  </span>
                  <input
                    type="date"
                    value={dateRange.end}
                    min={availableRange.start || undefined}
                    max={availableRange.end || undefined}
                    onChange={(event) => handleEndDateChange(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition-all focus:border-amber-300 focus:bg-white focus:ring-4 focus:ring-amber-100"
                  />
                </label>
              </div>

              {availableRange.start && availableRange.end && (
                <div className="rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-900">
                  Datos disponibles entre{" "}
                  <span className="font-semibold">
                    {formatDateLabel(availableRange.start, dateLabelOptions)}
                  </span>{" "}
                  y{" "}
                  <span className="font-semibold">
                    {formatDateLabel(availableRange.end, dateLabelOptions)}
                  </span>
                  .
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <StatCard
            icon={Store}
            label="Sedes evaluadas"
            value={String(visibleStats.evaluatedSedes)}
            description="Sedes visibles con inventario dentro de los filtros actuales."
            iconClassName="bg-amber-100 text-amber-700"
          />
          <StatCard
            icon={TrendingDown}
            label="Items visibles"
            value={String(visibleStats.visibleItems)}
            description="Referencias mostradas con datos reales del rango consultado."
            iconClassName="bg-sky-100 text-sky-700"
          />
          <StatCard
            icon={PackageSearch}
            label="Sin movimiento"
            value={String(visibleStats.withoutMovement)}
            description="Items con inventario vigente y venta acumulada en cero."
            iconClassName="bg-rose-100 text-rose-700"
          />
        </section>

        {error ? (
          <Card className="border-dashed border-rose-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardContent className="flex flex-col items-center px-6 py-12 text-center">
              <div className="rounded-full bg-rose-100 p-4 text-rose-700">
                <AlertCircle className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                No fue posible cargar la rotacion
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                {error}
              </p>
            </CardContent>
          </Card>
        ) : isLoadingData ? (
          <Card className="border-dashed border-amber-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardContent className="flex flex-col items-center px-6 py-12 text-center">
              <div className="rounded-full bg-amber-100 p-4 text-amber-700">
                <PackageSearch className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                Cargando rotacion real
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Estamos leyendo la tabla base y consolidando los items por sede para
                el rango seleccionado.
              </p>
            </CardContent>
          </Card>
        ) : rowsBySede.length === 0 ? (
          <Card className="border-dashed border-amber-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardContent className="flex flex-col items-center px-6 py-12 text-center">
              <div className="rounded-full bg-amber-100 p-4 text-amber-700">
                <AlertCircle className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                Sin resultados para los filtros actuales
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                No encontramos items con valor de inventario dentro del rango actual
                en{" "}
                <span className="font-semibold text-slate-800">
                  rotacion_base_item_dia_sede
                </span>
                . Ajusta el rango o baja el umbral para ampliar la lectura.
              </p>
            </CardContent>
          </Card>
        ) : (
          <section className="grid gap-5">
            {rowsBySede.map((group) => {
              const withoutMovement = group.rows.filter(
                (row) => row.status === "Sin movimiento",
              ).length;
              const lowRotation = group.rows.filter(
                (row) => row.status === "Baja rotacion",
              ).length;

              return (
                <Card
                  key={`${group.empresa}-${group.sedeId}`}
                  className="overflow-hidden border-slate-200/80 bg-white shadow-[0_24px_50px_-42px_rgba(15,23,42,0.65)]"
                >
                  <CardHeader className="border-b border-slate-100 bg-slate-50/70">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-2xl font-black text-slate-900">
                          {group.sedeName}
                        </CardTitle>
                        <CardDescription className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                          Consolidado real por sede usando ventas sin impuesto,
                          inventario de cierre y ultimo ingreso sobre el rango
                          seleccionado.
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">
                          {group.empresa}
                        </Badge>
                        <Badge className="border-slate-200 bg-white text-slate-700">
                          {group.rows.length} items
                        </Badge>
                        <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                          {lowRotation} baja rotacion
                        </Badge>
                        <Badge className="border-rose-200 bg-rose-50 text-rose-700">
                          {withoutMovement} sin movimiento
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-0 py-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
                          <TableHead className="px-4 py-3">Item</TableHead>
                          <TableHead className="px-4 py-3">Descripcion</TableHead>
                          <TableHead className="px-4 py-3">Venta periodo</TableHead>
                          <TableHead className="px-4 py-3">Inv. cierre</TableHead>
                          <TableHead className="px-4 py-3">Valor inventario</TableHead>
                          <TableHead className="px-4 py-3">Rotacion</TableHead>
                          <TableHead className="px-4 py-3">
                            <div className="flex flex-col">
                              <span>D.E</span>
                              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">
                                Dias efectivos
                              </span>
                            </div>
                          </TableHead>
                          <TableHead className="px-4 py-3">Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.rows.map((row) => (
                          <TableRow key={`${group.sedeId}-${row.item}`}>
                            <TableCell className="px-4 py-3 font-semibold text-slate-900">
                              {row.item}
                            </TableCell>
                            <TableCell className="px-4 py-3">
                              <div className="min-w-68">
                                <p className="font-medium text-slate-900">
                                  {row.descripcion}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  Linea {row.linea}
                                  {row.lineaN1Codigo ? ` | N1 ${row.lineaN1Codigo}` : ""}
                                  {row.unidad ? ` | ${row.unidad}` : ""}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="px-4 py-3 text-slate-700">
                              {formatPrice(row.totalSales)}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-slate-700">
                              {row.inventoryUnits.toLocaleString("es-CO")}{" "}
                              {row.unidad ?? ""}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-slate-700">
                              {formatPrice(row.inventoryValue)}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-slate-700">
                              {row.rotation.toFixed(2)}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-slate-700">
                              <div>
                                <p>{row.effectiveDays ?? "-"}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {row.lastMovementDate
                                    ? `Ult. ingreso ${formatDateLabel(
                                        row.lastMovementDate,
                                        dateLabelOptions,
                                      )}`
                                    : "Sin fecha de ingreso"}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="px-4 py-3">
                              <Badge
                                variant="outline"
                                className={getStatusBadgeClassName(row.status)}
                              >
                                {row.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        )}

        <Card className="border-slate-200/80 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
          <CardContent className="flex flex-col gap-3 px-6 py-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Fuente actual
              </p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">
                Base diaria conectada
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Esta lectura ya sale de{" "}
                <span className="font-semibold text-slate-800">
                  rotacion_base_item_dia_sede
                </span>
                . Cuando quieras, el siguiente ajuste puede ser mapearla al modelo
                por periodo que compartiste o afinar la formula exacta de rotacion.
              </p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {apiMessage ? (
                <span className="font-semibold">{apiMessage}</span>
              ) : (
                <>
                  Rango actual: <span className="font-semibold">{formattedRange}</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
