"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HourlyAnalysis } from "@/components/HourlyAnalysis";
import { DEFAULT_SEDES, type Sede } from "@/lib/constants";
import { canAccessPortalSection } from "@/lib/portal-sections";
import { normalizeKeyCompact } from "@/lib/normalize";
import type { DailyProductivity } from "@/types";

type AuthPayload = {
  user?: {
    role?: string;
    username?: string;
    allowedLines?: string[] | null;
    allowedDashboards?: string[] | null;
  } | null;
};

type ProductivityPayload = {
  dailyData?: DailyProductivity[];
  sedes?: Sede[];
  error?: string;
};

const HIDDEN_SEDE_KEYS = new Set(
  [
    "adm",
    "cedi-cavasa",
    "cedicavasa",
    "panificadora",
    "planta desposte mixto",
    "planta desprese pollo",
  ].map((value) => normalizeKeyCompact(value)),
);

const normalizeSedeKey = normalizeKeyCompact;

const resolveUsernameSedeKey = (value?: string | null) => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith("sede_")) return null;
  const raw = normalized.replace(/^sede_/, "").replace(/_/g, " ");
  return normalizeSedeKey(raw);
};

const resolveAllowedLineIds = (value?: string[] | null) => {
  if (!Array.isArray(value) || value.length === 0) return [];
  return Array.from(
    new Set(
      value
        .map((line) => (typeof line === "string" ? line.trim().toLowerCase() : ""))
        .filter(Boolean),
    ),
  );
};

const sortSedes = (sedes: Sede[]) =>
  [...sedes].sort((a, b) => a.name.localeCompare(b.name, "es"));

export default function ProductividadCajasPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [availableSedes, setAvailableSedes] = useState<Sede[]>([]);
  const [defaultSede, setDefaultSede] = useState<string | undefined>(undefined);
  const [allowedLineIds, setAllowedLineIds] = useState<string[]>([]);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const authResponse = await fetch("/api/auth/me", {
          signal: controller.signal,
        });
        if (authResponse.status === 401) {
          router.replace("/login");
          return;
        }
        if (!authResponse.ok) {
          throw new Error("No se pudo validar la sesion.");
        }

        const authPayload = (await authResponse.json()) as AuthPayload;
        const isAdmin = authPayload.user?.role === "admin";
        if (
          !isAdmin &&
          !canAccessPortalSection(authPayload.user?.allowedDashboards, "producto")
        ) {
          router.replace("/secciones");
          return;
        }

        const nextAllowedLineIds = resolveAllowedLineIds(authPayload.user?.allowedLines);
        const productivityResponse = await fetch("/api/productivity", {
          signal: controller.signal,
        });
        if (productivityResponse.status === 401) {
          router.replace("/login");
          return;
        }
        if (productivityResponse.status === 403) {
          router.replace("/secciones");
          return;
        }

        const productivityPayload =
          (await productivityResponse.json()) as ProductivityPayload;
        if (!productivityResponse.ok) {
          throw new Error(
            productivityPayload.error ?? "No se pudo cargar la informacion de cajas.",
          );
        }

        if (!isMounted) return;

        const nextDates = Array.from(
          new Set((productivityPayload.dailyData ?? []).map((item) => item.date)),
        ).sort((a, b) => a.localeCompare(b));
        const baseSedes =
          productivityPayload.sedes && productivityPayload.sedes.length > 0
            ? productivityPayload.sedes
            : DEFAULT_SEDES;
        const visibleSedes = sortSedes(
          baseSedes.filter((sede) => {
            const idKey = normalizeSedeKey(sede.id);
            const nameKey = normalizeSedeKey(sede.name);
            return !HIDDEN_SEDE_KEYS.has(idKey) && !HIDDEN_SEDE_KEYS.has(nameKey);
          }),
        );
        const preferredSedeKey = resolveUsernameSedeKey(authPayload.user?.username);
        const preferredSede = preferredSedeKey
          ? visibleSedes.find((sede) => {
              const idKey = normalizeSedeKey(sede.id || sede.name);
              const nameKey = normalizeSedeKey(sede.name);
              return idKey === preferredSedeKey || nameKey === preferredSedeKey;
            })
          : null;

        setAllowedLineIds(nextAllowedLineIds);
        setAvailableDates(nextDates);
        setAvailableSedes(visibleSedes);
        setDefaultSede(
          preferredSede?.name ?? (visibleSedes.length === 1 ? visibleSedes[0].name : undefined),
        );
        setReady(true);
        if (productivityPayload.error) {
          setError(productivityPayload.error);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadData();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [router]);

  const defaultDate = useMemo(
    () => (availableDates.length > 0 ? availableDates[availableDates.length - 1] : ""),
    [availableDates],
  );
  const canSeeCajas = allowedLineIds.length === 0 || allowedLineIds.includes("cajas");

  if (isLoading && !ready) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-5xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando modulo de cajas...</p>
        </div>
      </div>
    );
  }

  if (!canSeeCajas) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-12 text-foreground">
        <div className="mx-auto w-full max-w-3xl rounded-3xl border border-amber-200/70 bg-white p-7 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.25)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-600">
            Cajas
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            No tienes permisos para esta linea
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Tu usuario no tiene acceso a la linea de cajas dentro del modulo de
            productividad.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/productividad"
              className="inline-flex items-center rounded-full border border-slate-200/70 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-200/70"
            >
              Volver a Productividad
            </Link>
            <Link
              href="/secciones"
              className="inline-flex items-center rounded-full border border-blue-200/70 bg-blue-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 transition-all hover:border-blue-300 hover:bg-blue-100"
            >
              Cambiar seccion
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)] md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
              Productividad
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">Cajas</h1>
            <p className="mt-1 text-sm text-slate-600">
              Facturacion por hora y acumulado por rango horario para la sede
              seleccionada.
            </p>
          </div>
          <div className="flex flex-col gap-3 md:items-end">
            <div className="flex flex-wrap gap-2">
              <Link
                href="/productividad"
                className="inline-flex items-center rounded-full border border-slate-200/70 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-200/70"
              >
                Volver a Productividad
              </Link>
              <Link
                href="/secciones"
                className="inline-flex items-center rounded-full border border-blue-200/70 bg-blue-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 transition-all hover:border-blue-300 hover:bg-blue-100"
              >
                Cambiar seccion
              </Link>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-3">
                <Image
                  src="/logos/mercamio.jpeg"
                  alt="Logo Mercamio"
                  width={164}
                  height={52}
                  className="h-12 w-auto rounded-lg bg-white object-cover shadow-sm"
                />
                <Image
                  src="/logos/mercatodo.jpeg"
                  alt="Logo Mercatodo"
                  width={164}
                  height={52}
                  className="h-12 w-auto rounded-lg bg-white object-cover shadow-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            {error}
          </div>
        )}

        {/* Reutiliza el endpoint horario actual con la linea fija en cajas. */}
        <HourlyAnalysis
          availableDates={availableDates}
          availableSedes={availableSedes}
          allowedLineIds={allowedLineIds}
          defaultDate={defaultDate}
          defaultSede={defaultSede}
          defaultLine="cajas"
          sections={["map"]}
          defaultSection="map"
          showTopLineFilter={false}
          showComparison={false}
          showPersonBreakdown
          badgeLabel="Cajas por hora"
          panelTitle="Facturacion por intervalos"
          panelDescription="Consulta cuanto se facturo por hora y el acumulado del rango seleccionado usando la misma base horaria del modulo de productividad."
          dashboardContext="productividad"
        />
      </div>
    </div>
  );
}
