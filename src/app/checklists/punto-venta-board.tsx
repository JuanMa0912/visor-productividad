"use client";

import { useEffect, useMemo, useState } from "react";
import { useChecklistRunContext } from "@/app/checklists/checklist-run-context";
import { formatPriorAnswer } from "@/lib/checklists/snapshot";
import Link from "next/link";
import { BODEGA_DEFAULT_CFG } from "@/lib/checklists/bodega-gerencial";
import {
  PUNTO_VENTA_BLOCKS,
  scorePuntoVenta,
  type PuntoVentaScore,
} from "@/lib/checklists/punto-venta";
import { todayISO } from "@/lib/checklists/scoring";

const SCALE: Array<PuntoVentaScore> = [1, 2, 3, 4, 5, "na"];

const scaleLabel = (value: PuntoVentaScore) =>
  value === "na" ? "N.A." : String(value);

export function PuntoVentaBoard() {
  const [empresa, setEmpresa] = useState(BODEGA_DEFAULT_CFG[0]?.empresa ?? "");
  const [sede, setSede] = useState(BODEGA_DEFAULT_CFG[0]?.sedes[0] ?? "");
  const [fecha, setFecha] = useState(todayISO());
  const [hora, setHora] = useState("10:00");
  const [auditor, setAuditor] = useState("");
  const [adminPdV, setAdminPdV] = useState("");
  const [hallazgos, setHallazgos] = useState("");
  const [answers, setAnswers] = useState<Record<string, PuntoVentaScore | null>>(
    {},
  );
  const [notes, setNotes] = useState<Record<string, string>>({});

  const sedes =
    BODEGA_DEFAULT_CFG.find((row) => row.empresa === empresa)?.sedes ?? [];
  const score = useMemo(() => scorePuntoVenta(answers), [answers]);
  const runCtx = useChecklistRunContext();
  useEffect(() => {
    if (!runCtx) return;
    const snapshotAnswers: Record<string, { v: string | number | null; n?: string }> =
      {};
    for (const [key, value] of Object.entries(answers)) {
      snapshotAnswers[key] = { v: value, n: notes[key] };
    }
    runCtx.saveSnapshot({ answers: snapshotAnswers, scorePct: score.pct });
  }, [answers, notes, runCtx, score.pct]);

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900">
      <div className="mx-auto max-w-5xl px-3 py-3 pb-28 sm:px-4 sm:py-6">
        <Link href="/checklists" className="text-sm font-medium text-sky-800 hover:underline">
          ← Volver a checklists
        </Link>
        <header className="mt-3 rounded-xl border border-slate-200 bg-white p-3 sm:mt-4 sm:p-5">
          <h1 className="text-lg font-semibold tracking-tight sm:text-[22px]">
            CheckList PVTA — Punto de Venta
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Auditoría de surtido, precio, exhibición y gestión comercial · Escala 1 a 5
          </p>
          <div className="mt-3 grid gap-3 sm:mt-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Empresa
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base font-medium text-slate-900 sm:text-sm"
                value={empresa}
                onChange={(event) => {
                  const next = event.target.value;
                  setEmpresa(next);
                  const nextSedes =
                    BODEGA_DEFAULT_CFG.find((row) => row.empresa === next)?.sedes ??
                    [];
                  setSede(nextSedes[0] ?? "");
                }}
              >
                {BODEGA_DEFAULT_CFG.map((row) => (
                  <option key={row.empresa} value={row.empresa}>
                    {row.empresa}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Sede
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base font-medium text-slate-900 sm:text-sm"
                value={sede}
                onChange={(event) => setSede(event.target.value)}
              >
                {sedes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Fecha
              <input
                type="date"
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base text-slate-900 sm:text-sm"
                value={fecha}
                onChange={(event) => setFecha(event.target.value)}
              />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Hora de verificación
              <input
                type="time"
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base text-slate-900 sm:text-sm"
                value={hora}
                onChange={(event) => setHora(event.target.value)}
              />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Auditor / Responsable
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base text-slate-900 sm:text-sm"
                value={auditor}
                onChange={(event) => setAuditor(event.target.value)}
                placeholder="Nombre"
              />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Administrador del PDV
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base text-slate-900 sm:text-sm"
                value={adminPdV}
                onChange={(event) => setAdminPdV(event.target.value)}
                placeholder="Nombre"
              />
            </label>
          </div>
        </header>

        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600 sm:mt-4 sm:p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Escala de calificación
          </p>
          <div className="mt-2 hidden gap-1 sm:grid sm:grid-cols-2">
            <p>1 Crítico — incumplimiento total</p>
            <p>2 Deficiente — cumple parcialmente</p>
            <p>3 Aceptable — cumple lo básico</p>
            <p>4 Cumple — estándar logrado</p>
            <p>5 Sobresaliente — superior al estándar</p>
            <p>N.A. No aplica — se excluye del cálculo</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500 sm:hidden">
            1 crítico · 2 deficiente · 3 aceptable · 4 cumple · 5 sobresaliente · N.A. no aplica
          </p>
        </div>

        <div className="mt-3 space-y-3 sm:mt-4">
          {PUNTO_VENTA_BLOCKS.map((block, blockIndex) => (
            <section
              key={block.title}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
              <div className="flex items-center gap-3 border-b border-slate-200 bg-sky-50 px-3 py-3 sm:px-4">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-sky-800 text-xs font-bold text-white">
                  {blockIndex + 1}
                </span>
                <h2 className="text-sm font-semibold">{block.title}</h2>
              </div>
              {block.items.map((item) => (
                <div key={item.id} className="border-b border-slate-100 px-3 py-3 last:border-b-0 sm:px-4">
                  <div className="flex gap-3">
                    <span className="w-8 shrink-0 pt-0.5 text-xs font-bold text-slate-500">
                      {item.id}
                    </span>
                    <p className="min-w-0 text-[14.5px] leading-6">
                      {item.text}
                      {item.proposed ? (
                        <span className="ml-2 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800">
                          Propuesto
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="mt-3 space-y-2 pl-0 sm:pl-11">
                    {runCtx?.priorSnapshot?.answers[item.id] ? (
                      <p className="text-[10px] font-semibold text-indigo-700">
                        Encargado:{" "}
                        {formatPriorAnswer(
                          runCtx.priorSnapshot.answers[item.id]?.v,
                        )}
                      </p>
                    ) : null}
                    <div className="grid grid-cols-6 gap-1.5">
                      {SCALE.map((value) => {
                        const selected = answers[item.id] === value;
                        return (
                          <button
                            key={String(value)}
                            type="button"
                            onClick={() =>
                              setAnswers((current) => ({
                                ...current,
                                [item.id]: selected ? null : value,
                              }))
                            }
                            className={`grid min-h-11 place-items-center rounded-md border text-sm font-semibold ${
                              selected
                                ? value === "na"
                                  ? "border-slate-600 bg-slate-600 text-white"
                                  : "border-sky-800 bg-sky-800 text-white"
                                : "border-slate-200 bg-white text-slate-500"
                            }`}
                          >
                            {scaleLabel(value)}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      className="min-h-11 w-full min-w-0 rounded-md border border-slate-200 px-3 text-base sm:text-sm"
                      placeholder="Observación / evidencia / responsable"
                      value={notes[item.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>

        <section className="mt-4 rounded-xl border-2 border-sky-800 bg-white p-4 sm:mt-5 sm:p-5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-sky-800">
            Resultado de la auditoría
          </p>
          <p className="mt-2 text-3xl font-bold tabular-nums sm:text-4xl">
            {score.pct == null ? "—" : `${score.pct.toFixed(1)}%`}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {score.scored} de {score.total} ítems calificados · {score.applicable} aplicables
          </p>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Hallazgos críticos y compromisos (plan de acción)
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-base sm:text-sm"
              rows={3}
              value={hallazgos}
              onChange={(event) => setHallazgos(event.target.value)}
              placeholder="Qué se corrige, quién responde y en qué fecha"
            />
          </label>
        </section>
      </div>
    </div>
  );
}
