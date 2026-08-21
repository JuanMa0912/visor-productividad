"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatRangeLabel } from "./rotacion-preamble";

const CLIENT_TTL_MS = 3 * 60 * 1000;

export type RotacionInformePayload = {
  subject: string;
  html: string;
  range: { start: string; end: string };
  sedeCount: number;
  generatedAt: string;
};

let cached: { value: RotacionInformePayload; expiresAt: number } | null = null;
let inFlight: Promise<RotacionInformePayload> | null = null;

const loadRotacionInforme = async (): Promise<RotacionInformePayload> => {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const res = await fetch("/api/rotacion/informe", {
      credentials: "include",
    });
    const data = (await res.json().catch(() => null)) as
      | (Partial<RotacionInformePayload> & { error?: string })
      | null;
    if (!res.ok) {
      throw new Error(
        data?.error?.trim() || "No fue posible cargar el informe de rotacion.",
      );
    }
    if (!data?.html || !data.subject || !data.range || !data.generatedAt) {
      throw new Error("El informe de rotacion llego incompleto.");
    }
    const value: RotacionInformePayload = {
      subject: data.subject,
      html: data.html,
      range: {
        start: data.range.start ?? "",
        end: data.range.end ?? "",
      },
      sedeCount: Number(data.sedeCount) || 0,
      generatedAt: data.generatedAt,
    };
    cached = { value, expiresAt: Date.now() + CLIENT_TTL_MS };
    return value;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
};

/** Arranca la carga en segundo plano para que el tab salga de cache. */
export const prefetchRotacionInforme = () => {
  void loadRotacionInforme().catch(() => {
    /* el tab mostrara el error al abrirse */
  });
};

const formatGeneratedAt = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const extractEmailBody = (html: string) => {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match?.[1]?.trim() ?? html;
};

export const RotacionInformeBoard = () => {
  const [payload, setPayload] = useState<RotacionInformePayload | null>(
    () => (cached && cached.expiresAt > Date.now() ? cached.value : null),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!payload);

  useEffect(() => {
    let cancelled = false;
    void loadRotacionInforme()
      .then((next) => {
        if (cancelled) return;
        setPayload(next);
        setError(null);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar el informe de rotacion.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error && !payload) {
    return (
      <Card className="border-dashed border-rose-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
        <CardContent className="flex flex-col items-center px-6 py-12 text-center">
          <div className="rounded-full bg-rose-100 p-4 text-rose-700">
            <AlertCircle className="h-7 w-7" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-slate-900">
            No fue posible cargar el informe
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {error}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading && !payload) {
    return (
      <Card className="border-dashed border-amber-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
        <CardContent className="flex flex-col items-center px-6 py-12 text-center">
          <div className="rounded-full bg-amber-100 p-4 text-amber-700">
            <Loader2
              className="h-8 w-8 animate-spin motion-reduce:animate-none"
              strokeWidth={2}
            />
          </div>
          <h2 className="mt-4 text-xl font-bold text-slate-900">
            Armando el informe de todas las sedes
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Es el mismo correo consolidado de Manufactura D+0+S. La primera
            carga toma un momento; las siguientes salen de cache.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!payload) return null;

  const rangeLabel =
    payload.range.start && payload.range.end
      ? formatRangeLabel(payload.range)
      : "sin rango";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Mail className="h-3.5 w-3.5 text-amber-600" aria-hidden />
        <span className="font-medium text-slate-700">{payload.subject}</span>
        <span aria-hidden>·</span>
        <span>
          {payload.sedeCount} sedes · {rangeLabel} · generado{" "}
          {formatGeneratedAt(payload.generatedAt)}
        </span>
      </div>
      <div
        className="overflow-x-auto rounded-xl border border-slate-200 bg-[#f1f5f9] p-3 shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]"
        dangerouslySetInnerHTML={{ __html: extractEmailBody(payload.html) }}
      />
    </section>
  );
};
