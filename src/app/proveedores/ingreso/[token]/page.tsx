"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams } from "next/navigation";
import {
  PROVEEDORES_INGRESO_DATOS_AVISO,
  type ProveedorCatalogItem,
  type ProveedorVisitaOpen,
} from "@/lib/proveedores/types";

type Step = "cedula" | "entrada" | "salida" | "done";

export default function ProveedoresIngresoPage() {
  const params = useParams();
  const token = useMemo(
    () => String(params?.token ?? "").trim(),
    [params],
  );

  const [sedeName, setSedeName] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [catalogEmpty, setCatalogEmpty] = useState(false);
  const [step, setStep] = useState<Step>("cedula");
  const [cedula, setCedula] = useState("");
  const [nombre, setNombre] = useState("");
  const [proveedorQuery, setProveedorQuery] = useState("");
  const deferredQuery = useDeferredValue(proveedorQuery);
  const [providers, setProviders] = useState<ProveedorCatalogItem[]>([]);
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [selectedProveedor, setSelectedProveedor] =
    useState<ProveedorCatalogItem | null>(null);
  const [openVisit, setOpenVisit] = useState<ProveedorVisitaOpen | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autorizacionDatos, setAutorizacionDatos] = useState(false);

  const loadMeta = useCallback(
    async (q = "") => {
      if (!token) return;
      const paramsQs = new URLSearchParams({ token });
      if (q.trim()) paramsQs.set("q", q.trim());
      const response = await fetch(
        `/api/proveedores/ingreso?${paramsQs.toString()}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        error?: string;
        sedeName?: string;
        providers?: ProveedorCatalogItem[];
        catalogEmpty?: boolean;
      };
      if (!response.ok) {
        throw new Error(data.error || "Enlace no válido.");
      }
      setSedeName(data.sedeName ?? null);
      setProviders(data.providers ?? []);
      setCatalogEmpty(Boolean(data.catalogEmpty));
    },
    [token],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadMeta();
      } catch (err) {
        if (!cancelled) {
          setBootError(
            err instanceof Error ? err.message : "Enlace no válido.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMeta]);

  useEffect(() => {
    if (step !== "entrada") return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          await loadMeta(deferredQuery);
        } catch {
          if (!cancelled) setProviders([]);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [deferredQuery, loadMeta, step]);

  const onLookup = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const response = await fetch("/api/proveedores/ingreso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action: "lookup",
          cedula,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        status?: string;
        visit?: ProveedorVisitaOpen;
      };
      if (!response.ok) {
        throw new Error(data.error || "No se pudo consultar.");
      }
      if (data.status === "open" && data.visit) {
        setOpenVisit(data.visit);
        setStep("salida");
      } else {
        setOpenVisit(null);
        setStep("entrada");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const onEntrada = async () => {
    setError(null);
    setMessage(null);
    if (!proveedorId) {
      setError("Seleccione un proveedor de la lista.");
      return;
    }
    if (!autorizacionDatos) {
      setError(
        "Debe autorizar el tratamiento de datos personales para registrar la entrada.",
      );
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/proveedores/ingreso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action: "entrada",
          cedula,
          nombre,
          proveedorId,
          autorizacionDatos: true,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        visit?: ProveedorVisitaOpen;
      };
      if (!response.ok) {
        throw new Error(data.error || "No se pudo registrar la entrada.");
      }
      setOpenVisit(data.visit ?? null);
      setMessage(data.message ?? "Entrada registrada.");
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const onSalida = async () => {
    if (!openVisit) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const response = await fetch("/api/proveedores/ingreso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action: "salida",
          cedula,
          visitId: openVisit.id,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "No se pudo registrar la salida.");
      }
      setMessage(data.message ?? "Salida registrada.");
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setCedula("");
    setNombre("");
    setProveedorQuery("");
    setProveedorId(null);
    setSelectedProveedor(null);
    setOpenVisit(null);
    setMessage(null);
    setError(null);
    setAutorizacionDatos(false);
    setStep("cedula");
  };

  if (bootError) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-16 text-foreground">
        <div className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">Enlace no válido</h1>
          <p className="mt-2 text-sm text-slate-600">{bootError}</p>
        </div>
      </main>
    );
  }

  if (!sedeName) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-16">
        <p className="text-center text-sm text-slate-600">Cargando sede…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-foreground">
      <div className="mx-auto w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-700">
            Registro de proveedores
          </p>
          <h1 className="mt-2 text-xl font-black tracking-tight text-slate-900">
            {sedeName}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            La sede ya quedó fijada por este código QR. Ingrese su cédula: si
            tiene visita abierta se registra la salida; si no, la entrada.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {PROVEEDORES_INGRESO_DATOS_AVISO}
          </p>

          {error ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {message}
            </div>
          ) : null}

          {step === "cedula" ? (
            <div className="mt-5 space-y-3">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Cédula
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  value={cedula}
                  onChange={(e) =>
                    setCedula(e.target.value.replace(/\D/g, "").slice(0, 15))
                  }
                  className="mt-1 block h-11 w-full rounded-xl border border-slate-200 px-3 text-base"
                  placeholder="Solo números"
                />
              </label>
              <button
                type="button"
                disabled={busy || cedula.length < 6}
                onClick={() => void onLookup()}
                className="h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Consultando…" : "Continuar"}
              </button>
            </div>
          ) : null}

          {step === "entrada" ? (
            <div className="mt-5 space-y-3">
              <p className="text-xs font-semibold text-slate-700">
                Cédula {cedula} · registrar entrada
              </p>
              {catalogEmpty ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  El catálogo de proveedores aún no está cargado. Avise a
                  administración.
                </div>
              ) : null}
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Nombre completo
                <input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value.slice(0, 120))}
                  className="mt-1 block h-11 w-full rounded-xl border border-slate-200 px-3 text-base"
                  autoComplete="name"
                />
              </label>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Buscar proveedor
                <input
                  value={proveedorQuery}
                  onChange={(e) => {
                    setProveedorQuery(e.target.value);
                    setProveedorId(null);
                    setSelectedProveedor(null);
                  }}
                  className="mt-1 block h-11 w-full rounded-xl border border-slate-200 px-3 text-base"
                  placeholder="Nombre, NIT o código"
                  disabled={catalogEmpty}
                />
              </label>
              <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200">
                {providers.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-slate-500">
                    Sin resultados
                  </p>
                ) : (
                  providers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setProveedorId(p.id);
                        setSelectedProveedor(p);
                        setProveedorQuery(p.nombre);
                      }}
                      className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left text-sm last:border-0 ${
                        proveedorId === p.id
                          ? "bg-sky-50 font-semibold text-sky-900"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="block">{p.nombre}</span>
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">
                        NIT {p.nit ?? "sin NIT"}
                        {p.sucursal !== "00" ? ` · sucursal ${p.sucursal}` : ""}
                      </span>
                    </button>
                  ))
                )}
              </div>
              {selectedProveedor ? (
                <p className="text-xs text-slate-500">
                  Seleccionado:{" "}
                  <span className="font-semibold text-slate-800">
                    {selectedProveedor.nombre}
                  </span>
                  {selectedProveedor.nit ? ` · NIT ${selectedProveedor.nit}` : ""}
                </p>
              ) : null}
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={autorizacionDatos}
                  onChange={(e) => setAutorizacionDatos(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-sky-700 focus:ring-sky-200"
                />
                <span className="leading-relaxed">
                  Autorizo el tratamiento de mis datos personales (nombre y
                  cédula) para el control de ingreso a esta sede, según la Ley
                  1581 de 2012.
                </span>
              </label>
              <button
                type="button"
                disabled={
                  busy ||
                  catalogEmpty ||
                  !proveedorId ||
                  nombre.trim().length < 3 ||
                  !autorizacionDatos
                }
                onClick={() => void onEntrada()}
                className="h-11 w-full rounded-xl bg-sky-700 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Guardando…" : "Registrar entrada"}
              </button>
              <button
                type="button"
                onClick={reset}
                className="h-10 w-full text-sm font-semibold text-slate-500"
              >
                Volver
              </button>
            </div>
          ) : null}

          {step === "salida" && openVisit ? (
            <div className="mt-5 space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <p>
                  <span className="font-semibold">Visita abierta</span>
                </p>
                <p className="mt-1">{openVisit.visitanteNombre}</p>
                <p className="text-slate-500">{openVisit.proveedorNombre}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Entrada:{" "}
                  {new Date(openVisit.entradaAt).toLocaleString("es-CO")}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSalida()}
                className="h-11 w-full rounded-xl bg-emerald-700 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Guardando…" : "Registrar salida"}
              </button>
              <button
                type="button"
                onClick={reset}
                className="h-10 w-full text-sm font-semibold text-slate-500"
              >
                Cancelar
              </button>
            </div>
          ) : null}

          {step === "done" ? (
            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={reset}
                className="h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white"
              >
                Nuevo registro
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
