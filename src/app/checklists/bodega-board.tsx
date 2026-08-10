"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import Link from "next/link";
import {
  BODEGA_BLOCKS,
  BODEGA_DEFAULT_CFG,
  BODEGA_DEFAULT_PESOS,
} from "@/lib/checklists/bodega-gerencial";
import {
  addDaysISO,
  cloneBlocksWithPesos,
  computeChecklist,
  ESTADO_META,
  initStates,
  listActionItems,
  normalizePesos,
  priorityOf,
  PRIORITY_META,
  todayISO,
  verdictScale,
} from "@/lib/checklists/scoring";
import { ANSWER_FACTOR, emptyItemState } from "@/lib/checklists/types";
import type {
  ChecklistAnswer,
  ChecklistBlock,
  ChecklistEmpresaSedes,
  ChecklistItemState,
  ChecklistMeta,
} from "@/lib/checklists/types";
import "./bodega-board.css";

type TabId = "a" | "c" | "g";

type SavedAudit = {
  tipo?: string;
  meta: ChecklistMeta;
  resultado: {
    pct: number | null;
    p: number;
    po: number;
    cr: number;
    hl: number;
    bloques: Array<{
      l: string;
      t: string;
      a: string;
      pct: number | null;
    }>;
  };
  respuestas?: Record<string, ChecklistItemState>;
};

const ANSWERS: ChecklistAnswer[] = ["C", "P", "NC", "NA"];
const WL: Record<1 | 2 | 3, string> = {
  3: "Crítico",
  2: "Alto",
  1: "Medio",
};
const CFG_COLORS = [
  "var(--s1)",
  "var(--s3)",
  "var(--s4)",
  "var(--s2)",
  "var(--s5)",
  "var(--s6)",
];
const MEDAL = ["#eda100", "#898781", "#eb6834"];

const csvQ = (v: unknown) =>
  `"${String(v ?? "").replace(/"/g, '""')}"`;

const downloadBlob = (name: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
};

const fileNameBase = (meta: ChecklistMeta) =>
  `bodega_${meta.sede || "sede"}_${meta.fecha || ""}`.replace(
    /[^\w\-]+/g,
    "_",
  );

const round1 = (n: number) => Math.round(n * 10) / 10;

export function BodegaGerencialBoard() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [tab, setTab] = useState<TabId>("a");
  const [cfg, setCfg] = useState<ChecklistEmpresaSedes[]>(() =>
    structuredClone(BODEGA_DEFAULT_CFG),
  );
  const [blocks, setBlocks] = useState<ChecklistBlock[]>(() =>
    cloneBlocksWithPesos(BODEGA_BLOCKS, BODEGA_DEFAULT_PESOS),
  );
  const [states, setStates] = useState(() => initStates(BODEGA_BLOCKS));
  const [meta, setMeta] = useState<ChecklistMeta>(() => ({
    empresa: BODEGA_DEFAULT_CFG[0]?.empresa ?? "",
    sede: BODEGA_DEFAULT_CFG[0]?.sedes[0] ?? "",
    fecha: todayISO(),
    auditor: "",
    responsable: "",
  }));
  const [showAllCriteria, setShowAllCriteria] = useState(false);
  const [openCriteria, setOpenCriteria] = useState<Record<number, boolean>>(
    {},
  );
  const [toastMsg, setToastMsg] = useState("");
  const [toastOn, setToastOn] = useState(false);
  const [cons, setCons] = useState<SavedAudit[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const auditFileRef = useRef<HTMLInputElement>(null);
  const consFileRef = useRef<HTMLInputElement>(null);
  const cfgFileRef = useRef<HTMLInputElement>(null);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setToastOn(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastOn(false), 2000);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const sedes = useMemo(() => {
    const g = cfg.find((x) => x.empresa === meta.empresa);
    return g?.sedes ?? [];
  }, [cfg, meta.empresa]);

  const sedeValue = sedes.includes(meta.sede)
    ? meta.sede
    : (sedes[0] ?? "");
  const metaLive = useMemo(
    () => ({ ...meta, sede: sedeValue }),
    [meta, sedeValue],
  );

  const result = useMemo(
    () => computeChecklist(blocks, states),
    [blocks, states],
  );
  const pct =
    result.pct == null ? null : Math.round(result.pct * 10) / 10;
  const scale = verdictScale(pct);
  const actionItems = useMemo(
    () => listActionItems(blocks, states),
    [blocks, states],
  );

  const criticalItems = useMemo(() => {
    const out: Array<{ c: number; x: string }> = [];
    for (const b of blocks) {
      for (const it of b.q) {
        if (states[it.c]?.v === "NC" && it.w === 3) {
          out.push({ c: it.c, x: it.x });
        }
      }
    }
    return out;
  }, [blocks, states]);

  const setAnswer = (c: number, v: ChecklistAnswer) => {
    setStates((prev) => {
      const cur = prev[c] ?? emptyItemState();
      const next = cur.v === v ? null : v;
      const updated: ChecklistItemState = { ...cur, v: next };
      if (next === "P" || next === "NC") {
        const it = blocks.flatMap((b) => b.q).find((q) => q.c === c);
        if (it) {
          const pr = priorityOf(it, next) as 1 | 2 | 3;
          if (!updated.ac) updated.ac = it.ac;
          if (!updated.f) {
            updated.f = addDaysISO(meta.fecha, PRIORITY_META[pr].d);
          }
        }
      }
      return { ...prev, [c]: updated };
    });
  };

  const patchState = (
    c: number,
    key: keyof ChecklistItemState,
    value: string,
  ) => {
    setStates((prev) => {
      const cur = prev[c] ?? emptyItemState();
      return { ...prev, [c]: { ...cur, [key]: value } };
    });
  };

  const todoCumple = () => {
    setStates((prev) => {
      const next = { ...prev };
      for (const b of blocks) {
        for (const it of b.q) {
          next[it.c] = { ...(next[it.c] ?? emptyItemState()), v: "C" };
        }
      }
      return next;
    });
  };

  const limpiar = () => {
    setStates(initStates(blocks));
    setOpenCriteria({});
  };

  const toggleCriteria = (c: number) => {
    setOpenCriteria((prev) => ({ ...prev, [c]: !prev[c] }));
  };

  const exportCsv = () => {
    const L: string[] = [];
    L.push([csvQ("CHECKLIST DE BODEGA")].join(";"));
    L.push(
      ["Empresa", metaLive.empresa, "Sede", metaLive.sede, "Fecha", metaLive.fecha]
        .map(csvQ)
        .join(";"),
    );
    L.push(
      ["Auditor", metaLive.auditor, "Responsable", metaLive.responsable]
        .map(csvQ)
        .join(";"),
    );
    L.push(
      [
        "Cumplimiento global",
        pct == null ? "" : `${pct.toFixed(1)}%`,
        "Puntos logrados",
        result.p,
        "Puntos aplicables",
        result.po,
        "Pendientes",
        result.pend,
        "Críticos NC",
        result.cr,
      ]
        .map(csvQ)
        .join(";"),
    );
    L.push("");
    L.push(
      [
        "Bloque",
        "#",
        "Punto de control",
        "Criterio de aceptación",
        "Criticidad",
        "Peso %",
        "Resultado",
        "Factor",
        "Puntos logrados",
        "Hallazgo",
        "Causa raíz",
        "Acción correctiva",
        "Responsable",
        "Fecha límite",
        "Estado",
      ]
        .map(csvQ)
        .join(";"),
    );
    for (const b of blocks) {
      for (const it of b.q) {
        const s = states[it.c] ?? emptyItemState();
        const act = s.v === "NC" || s.v === "P";
        L.push(
          [
            `${b.l}. ${b.t}`,
            it.c,
            it.x,
            it.k,
            WL[it.w],
            it.p,
            s.v || "Sin evaluar",
            s.v && s.v !== "NA" ? ANSWER_FACTOR[s.v] : "",
            s.v === "NA" ? "N/A" : s.v ? ANSWER_FACTOR[s.v] * it.p : 0,
            s.h,
            act ? s.cz : "",
            act ? s.ac || it.ac : "",
            s.r,
            s.f,
            act ? s.es : "",
          ]
            .map(csvQ)
            .join(";"),
        );
      }
    }
    L.push("");
    L.push([csvQ("RESUMEN POR BLOQUE")].join(";"));
    L.push(
      [
        "Bloque",
        "Peso %",
        "Peso aplicable",
        "Puntos logrados",
        "% del bloque",
        "Evaluados",
        "Total",
      ]
        .map(csvQ)
        .join(";"),
    );
    for (const b of result.bl) {
      L.push(
        [
          `${b.l}. ${b.t}`,
          b.peso,
          b.ap,
          Math.round(b.pts * 100) / 100,
          b.pct == null ? "" : b.pct.toFixed(1),
          b.ev,
          b.n,
        ]
          .map(csvQ)
          .join(";"),
      );
    }
    downloadBlob(
      `${fileNameBase(metaLive)}.csv`,
      `\uFEFF${L.join("\r\n")}`,
      "text/csv;charset=utf-8",
    );
    toast("CSV descargado");
  };

  const exportJson = () => {
    const payload = {
      tipo: "bodega-gerencial",
      meta: metaLive,
      resultado: {
        pct: result.pct,
        p: result.p,
        po: result.po,
        cr: result.cr,
        hl: result.hl,
        bloques: result.bl,
      },
      respuestas: states,
    };
    downloadBlob(
      `${fileNameBase(metaLive)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
    toast("Auditoría guardada");
  };

  const importAudit = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const j = JSON.parse(String(reader.result)) as SavedAudit;
        const m = j.meta || ({} as ChecklistMeta);
        setCfg((prev) => {
          let next = prev;
          if (m.empresa) {
            next = structuredClone(prev);
            let g = next.find((x) => x.empresa === m.empresa);
            if (!g) {
              g = { empresa: m.empresa, sedes: [] };
              next.push(g);
            }
            if (m.sede && !g.sedes.includes(m.sede)) g.sedes.push(m.sede);
          }
          return next;
        });
        setMeta({
          empresa: m.empresa || meta.empresa,
          sede: m.sede || meta.sede,
          fecha: m.fecha || "",
          auditor: m.auditor || "",
          responsable: m.responsable || "",
        });
        const nextStates = initStates(blocks);
        const resp = j.respuestas || {};
        for (const key of Object.keys(resp)) {
          const c = Number(key);
          if (!nextStates[c]) continue;
          nextStates[c] = {
            ...emptyItemState(),
            ...resp[key],
          };
        }
        setStates(nextStates);
        toast("Auditoría cargada");
      } catch {
        toast("Archivo no válido");
      }
    };
    reader.readAsText(f);
  };

  const exportPlanCsv = () => {
    const A = listActionItems(blocks, states);
    if (!A.length) {
      toast("No hay acciones en el plan");
      return;
    }
    const L: string[] = [];
    L.push([csvQ("PLAN DE ACCIÓN — CHECKLIST DE BODEGA")].join(";"));
    L.push(
      [
        "Empresa",
        meta.empresa,
        "Sede",
        meta.sede,
        "Fecha auditoría",
        meta.fecha,
        "Auditor",
        meta.auditor,
      ]
        .map(csvQ)
        .join(";"),
    );
    L.push("");
    L.push(
      [
        "Prioridad",
        "Plazo",
        "#",
        "Bloque",
        "Punto de control",
        "Resultado",
        "Hallazgo",
        "Causa raíz",
        "Acción correctiva",
        "Responsable",
        "Fecha límite",
        "Estado",
        "Puntos en juego",
      ]
        .map(csvQ)
        .join(";"),
    );
    for (const a of A) {
      const P = PRIORITY_META[a.pr];
      L.push(
        [
          P.l,
          P.d === 1 ? "24 horas" : `${P.d} días`,
          a.it.c,
          `${a.block.l}. ${a.block.t}`,
          a.it.x,
          a.s.v === "NC" ? "No cumple" : "Parcial",
          a.s.h,
          a.s.cz,
          a.s.ac || a.it.ac,
          a.s.r,
          a.s.f,
          a.s.es,
          Math.round(a.juego * 100) / 100,
        ]
          .map(csvQ)
          .join(";"),
      );
    }
    downloadBlob(
      `plan_accion_${fileNameBase(metaLive)}.csv`,
      `\uFEFF${L.join("\r\n")}`,
      "text/csv;charset=utf-8",
    );
    toast("Plan de acción descargado");
  };

  const importCons = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length) return;
    let pending = files.length;
    const loaded: SavedAudit[] = [];
    files.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const j = JSON.parse(String(reader.result)) as SavedAudit;
          if (j.resultado) loaded.push(j);
        } catch {
          /* ignore */
        }
        pending -= 1;
        if (pending === 0) {
          setCons((prev) => [...prev, ...loaded]);
          toast(`${loaded.length} sede(s) cargada(s)`);
        }
      };
      reader.readAsText(f);
    });
  };

  const exportConsCsv = () => {
    if (!cons.length) {
      toast("Sin datos");
      return;
    }
    const L = [
      [
        "Empresa",
        "Sede",
        "Fecha",
        "Auditor",
        "% Cumplimiento",
        "Críticos NC",
        "Hallazgos",
      ]
        .map(csvQ)
        .join(";"),
    ];
    for (const j of cons) {
      L.push(
        [
          j.meta.empresa,
          j.meta.sede,
          j.meta.fecha,
          j.meta.auditor,
          j.resultado.pct == null ? "" : j.resultado.pct.toFixed(1),
          j.resultado.cr,
          j.resultado.hl,
        ]
          .map(csvQ)
          .join(";"),
      );
    }
    downloadBlob(
      "comparativo_sedes.csv",
      `\uFEFF${L.join("\r\n")}`,
      "text/csv;charset=utf-8",
    );
    toast("Comparativo descargado");
  };

  const setPeso = (c: number, raw: string) => {
    const n = Math.max(0, parseFloat(raw) || 0);
    setBlocks((prev) =>
      prev.map((b) => ({
        ...b,
        q: b.q.map((it) => (it.c === c ? { ...it, p: n } : it)),
      })),
    );
  };

  const doNormalize = () => {
    const tot = blocks.reduce(
      (a, b) => a + b.q.reduce((x, y) => x + y.p, 0),
      0,
    );
    if (!tot) {
      toast("Los pesos están en cero");
      return;
    }
    setBlocks(normalizePesos(blocks));
    toast("Pesos normalizados a 100%");
  };

  const resetPesos = () => {
    setBlocks(cloneBlocksWithPesos(BODEGA_BLOCKS, BODEGA_DEFAULT_PESOS));
    toast("Pesos sugeridos restaurados");
  };

  const exportCfg = () => {
    const pesos: Record<number, number> = {};
    for (const b of blocks) {
      for (const it of b.q) pesos[it.c] = it.p;
    }
    downloadBlob(
      "config_bodega.json",
      JSON.stringify({ tipo: "config-bodega", CFG: cfg, pesos }, null, 2),
      "application/json",
    );
    toast("Configuración descargada");
  };

  const importCfg = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const j = JSON.parse(String(reader.result)) as {
          CFG?: ChecklistEmpresaSedes[];
          pesos?: Record<string, number>;
        };
        if (j.CFG) {
          setCfg(j.CFG);
          const first = j.CFG[0];
          setMeta((m) => ({
            ...m,
            empresa: first?.empresa ?? m.empresa,
            sede: first?.sedes[0] ?? m.sede,
          }));
        }
        if (j.pesos) {
          const pesos: Record<number, number> = {};
          for (const [k, v] of Object.entries(j.pesos)) {
            pesos[Number(k)] = Number(v);
          }
          setBlocks(cloneBlocksWithPesos(BODEGA_BLOCKS, pesos));
        }
        toast("Configuración cargada");
      } catch {
        toast("Archivo no válido");
      }
    };
    reader.readAsText(f);
  };

  const hoy = todayISO();
  const openActions = actionItems.filter((a) => a.s.es !== "Cerrada");
  const closedActions = actionItems.filter((a) => a.s.es === "Cerrada");
  const p1 = openActions.filter((a) => a.pr === 1).length;
  const p2 = openActions.filter((a) => a.pr === 2).length;
  const p3 = openActions.filter((a) => a.pr === 3).length;
  const vencidas = openActions.filter((a) => a.s.f && a.s.f < hoy).length;
  const recPts = openActions.reduce((x, a) => x + a.juego, 0);
  const ganPts = closedActions.reduce((x, a) => x + a.juego, 0);
  const proy =
    result.po ? ((result.p + recPts + ganPts) / result.po) * 100 : null;

  const pesosTot = blocks.reduce(
    (a, b) => a + b.q.reduce((x, y) => x + y.p, 0),
    0,
  );
  const pesosOk = Math.abs(pesosTot - 100) < 0.05;

  // Donut segments
  const donutOrd: ChecklistAnswer[] = ["C", "P", "NC", "NA"];
  let donutOff = 25;
  const donutSegs = donutOrd.map((k) => {
    const v = (result.cnt[k] / result.tot) * 100;
    const seg = { k, v, off: donutOff };
    donutOff -= v;
    return seg;
  });
  const donutColors: Record<ChecklistAnswer, string> = {
    C: "var(--good)",
    P: "var(--warn)",
    NC: "var(--crit)",
    NA: "var(--ink3)",
  };

  const consRows = useMemo(() => {
    return cons
      .map((j) => ({
        e: j.meta.empresa,
        s: j.meta.sede,
        f: j.meta.fecha,
        p: j.resultado.pct || 0,
        c: j.resultado.cr || 0,
        bl: j.resultado.bloques || [],
      }))
      .sort((a, b) => b.p - a.p);
  }, [cons]);

  const consProm =
    consRows.length
      ? consRows.reduce((a, r) => a + r.p, 0) / consRows.length
      : 0;

  const networkFocus = useMemo(() => {
    const ag: Record<
      string,
      { t: string; a: string; s: number; n: number }
    > = {};
    for (const r of consRows) {
      for (const b of r.bl) {
        if (b.pct == null) continue;
        ag[b.l] = ag[b.l] || { t: b.t, a: b.a, s: 0, n: 0 };
        ag[b.l].s += b.pct;
        ag[b.l].n += 1;
      }
    }
    return Object.entries(ag)
      .map(([l, v]) => ({ l, t: v.t, a: v.a, p: v.s / v.n }))
      .sort((a, b) => a.p - b.p);
  }, [consRows]);

  const scrollToBlock = (l: string) => {
    const el = document.querySelector(`.cb-root .block[data-b="${l}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const totalPtsLabel = blocks.reduce((a, b) => a + b.q.length, 0);

  return (
    <div className="cb-root" data-theme={theme}>
      <div
        id="prog"
        style={{ width: `${(result.ev / result.tot) * 100}%` }}
      />
      <header>
        <div className="wrap">
          <Link className="back-link" href="/checklists">
            ← Volver a checklists
          </Link>
          <div className="row1">
            <div className="mk">CB</div>
            <div>
              <h1>Checklist de Bodega — Tablero Gerencial</h1>
              <div className="sub">
                {totalPtsLabel} puntos · {blocks.length} bloques · calificación
                ponderada en vivo
              </div>
            </div>
            <div className="sp" />
            <button
              type="button"
              className="gh"
              onClick={() =>
                setTheme((t) => (t === "dark" ? "light" : "dark"))
              }
            >
              {theme === "dark" ? "Modo claro" : "Modo oscuro"}
            </button>
          </div>
          <div className="row2">
            <div className="f">
              <label>Empresa</label>
              <select
                value={meta.empresa}
                onChange={(e) => {
                  const empresa = e.target.value;
                  const g = cfg.find((x) => x.empresa === empresa);
                  setMeta((m) => ({
                    ...m,
                    empresa,
                    sede: g?.sedes[0] ?? "",
                  }));
                }}
              >
                {cfg.map((g) => (
                  <option key={g.empresa} value={g.empresa}>
                    {g.empresa}
                  </option>
                ))}
              </select>
            </div>
            <div className="f">
              <label>Sede</label>
              <select
                value={sedeValue}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, sede: e.target.value }))
                }
              >
                {sedes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="f">
              <label>Fecha</label>
              <input
                type="date"
                value={meta.fecha}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, fecha: e.target.value }))
                }
              />
            </div>
            <div className="f">
              <label>Auditor</label>
              <input
                placeholder="Quien audita"
                value={meta.auditor}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, auditor: e.target.value }))
                }
              />
            </div>
            <div className="f">
              <label>Responsable bodega</label>
              <input
                placeholder="Responsable"
                value={meta.responsable}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, responsable: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="tabs">
            {(
              [
                ["a", "Auditoría"],
                ["c", "Comparativo de sedes"],
                ["g", "Configuración"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                data-t={id}
                onClick={() => {
                  setTab(id);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="wrap">
        {/* ——— Auditoría ——— */}
        <div id="ta" className={tab === "a" ? undefined : "hide"}>
          <div className="cols">
            <div>
              <div className="bar no-p">
                <button type="button" className="btn g" onClick={todoCumple}>
                  Todo cumple
                </button>
                <button type="button" className="btn" onClick={limpiar}>
                  Limpiar
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowAllCriteria((v) => !v)}
                >
                  {showAllCriteria ? "Ocultar criterios" : "Ver criterios"}
                </button>
                <button type="button" className="btn p" onClick={exportCsv}>
                  Excel / CSV
                </button>
                <button type="button" className="btn" onClick={exportJson}>
                  Guardar
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => auditFileRef.current?.click()}
                >
                  Cargar
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => window.print()}
                >
                  Imprimir / PDF
                </button>
                <input
                  ref={auditFileRef}
                  type="file"
                  accept=".json"
                  className="hide"
                  onChange={importAudit}
                />
              </div>

              {criticalItems.length > 0 && (
                <div className="alert">
                  <b style={{ color: "var(--crit)" }}>Sede NO CONFORME.</b>{" "}
                  {criticalItems.length} punto(s) crítico(s) incumplidos —
                  requieren acta y cierre en 24 horas:
                  <br />
                  {criticalItems.map((x) => (
                    <span key={x.c}>
                      · <b>{x.c}.</b> {x.x}
                      <br />
                    </span>
                  ))}
                </div>
              )}

              {blocks.map((b, bi) => {
                const bs = result.bl[bi];
                const pc =
                  bs?.pct == null ? null : Math.round(bs.pct);
                const z = verdictScale(pc);
                return (
                  <div
                    key={b.l}
                    className="block"
                    style={
                      {
                        "--acc": b.a,
                        animationDelay: `${bi * 55}ms`,
                      } as CSSProperties
                    }
                    data-b={b.l}
                  >
                    <div className="bh">
                      <span className="ltr">{b.l}</span>
                      <span className="bt">{b.t}</span>
                      <span className="bmeta">
                        <span className="pw">
                          peso {round1(b.q.reduce((a, x) => a + x.p, 0))}%
                        </span>
                        <span className="tr">
                          <i
                            style={{
                              width: `${pc || 0}%`,
                              background: z.c,
                            }}
                          />
                        </span>
                        <span
                          className="bp"
                          style={{
                            color: pc == null ? "var(--ink3)" : z.c,
                          }}
                          title={
                            bs
                              ? `Puntos logrados de los ${bs.ap} aplicables en este bloque`
                              : undefined
                          }
                        >
                          {pc == null ? "—" : `${pc}%`} ·{" "}
                          {bs ? `${round1(bs.pts)}/${bs.ap}` : "0/0"} pts
                        </span>
                      </span>
                    </div>
                    {b.q.map((it) => {
                      const s = states[it.c] ?? emptyItemState();
                      const isOpen = showAllCriteria || openCriteria[it.c];
                      const showF = s.v === "NC" || s.v === "P";
                      return (
                        <div key={it.c}>
                          <div
                            className={[
                              "q",
                              isOpen ? "open" : "",
                              showF ? "showf" : "",
                              s.v === "NC" ? "miss" : "",
                              s.v === "P" ? "part" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            data-c={it.c}
                          >
                            <span className="qn">{it.c}</span>
                            <div className="qb">
                              <div className="qt">
                                {it.x}
                                {it.w === 3 && (
                                  <span className="star">CRÍTICO</span>
                                )}
                                <span
                                  className="pz"
                                  title="Peso de este punto en la calificación"
                                >
                                  {it.p}%
                                </span>
                              </div>
                              <div className="kr">
                                <b>Criterio de aceptación:</b> {it.k}
                              </div>
                              <button
                                type="button"
                                className="kt"
                                onClick={() => toggleCriteria(it.c)}
                              >
                                ver criterio
                              </button>
                            </div>
                            <div className="opts">
                              {ANSWERS.map((v) => (
                                <button
                                  key={v}
                                  type="button"
                                  className="o"
                                  data-v={v}
                                  data-on={s.v === v ? "1" : "0"}
                                  onClick={() => setAnswer(it.c, v)}
                                >
                                  {v}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="fnd" data-f={it.c}>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <label>
                                Hallazgo — qué se encontró en el recorrido
                              </label>
                              <input
                                placeholder="Ej: 2 cajas de yogurt vencidas en el rack 3, nivel 2"
                                value={s.h}
                                onChange={(e) =>
                                  patchState(it.c, "h", e.target.value)
                                }
                              />
                            </div>
                            <div
                              style={{
                                gridColumn: "1 / -1",
                                fontSize: "11.5px",
                                color: "var(--ink3)",
                                marginTop: "-2px",
                              }}
                            >
                              La causa, la acción correctiva, el responsable y
                              la fecha se completan abajo, en el{" "}
                              <b>plan de acción</b>.
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <aside className="panel">
              <div className="card">
                <div
                  className="gauge"
                  style={
                    {
                      "--gA": scale.g[0],
                      "--gB": scale.g[1],
                    } as CSSProperties
                  }
                >
                  <svg width="200" height="112" viewBox="0 0 200 112">
                    <defs>
                      <linearGradient id="gg" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="var(--gA)" />
                        <stop offset="100%" stopColor="var(--gB)" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M16 100 A84 84 0 0 1 184 100"
                      fill="none"
                      stroke="var(--grid)"
                      strokeWidth="16"
                      strokeLinecap="round"
                    />
                    <path
                      id="gArc"
                      d="M16 100 A84 84 0 0 1 184 100"
                      fill="none"
                      stroke="url(#gg)"
                      strokeWidth="16"
                      strokeLinecap="round"
                      strokeDasharray="264"
                      strokeDashoffset={264 - (264 * (pct || 0)) / 100}
                    />
                  </svg>
                  <div className="gv">
                    {pct == null ? "—" : `${pct.toFixed(1)}%`}
                  </div>
                  <div className="gl">Cumplimiento global</div>
                  <div className="gsub">
                    {result.pend > 0 ? (
                      <>
                        <b>{round1(result.p)}</b> de <b>{result.po}</b> puntos ·
                        faltan {round1(result.pend)} por evaluar
                        <br />
                        <span style={{ color: "var(--ink3)" }}>
                          máximo alcanzable {round1(result.max ?? 0)}%
                        </span>
                      </>
                    ) : (
                      <>
                        <b>{round1(result.p)}</b> de <b>{result.po}</b> puntos ·
                        auditoría completa
                      </>
                    )}
                  </div>
                </div>
                <div
                  className={`verdict${result.cr > 0 ? " no" : ""}`}
                  style={{
                    background:
                      result.cr > 0
                        ? "linear-gradient(100deg,rgba(208,59,59,.18),rgba(208,59,59,.06))"
                        : scale.bg,
                    color: result.cr > 0 ? "var(--crit)" : scale.fg,
                    borderColor:
                      result.cr > 0 ? "var(--crit)" : "var(--border)",
                  }}
                >
                  {result.cr > 0
                    ? `NO CONFORME · ${result.cr} crítico(s)`
                    : scale.l}
                </div>
                <div className="kpis">
                  <div className="kp k1">
                    <b style={{ color: "var(--crit)" }}>{result.cr}</b>
                    <span>Críticos NC</span>
                  </div>
                  <div className="kp k2">
                    <b style={{ color: "#8a5c00" }}>{result.hl}</b>
                    <span>Hallazgos</span>
                  </div>
                  <div className="kp k3">
                    <b style={{ color: "var(--s1)" }}>
                      {round1(result.p)}/{result.po}
                    </b>
                    <span>Puntos</span>
                  </div>
                  <div className="kp k4">
                    <b style={{ color: "var(--s3)" }}>
                      {result.ev}/{result.tot}
                    </b>
                    <span>Evaluados</span>
                  </div>
                </div>
              </div>

              <div className="card">
                <h2>Distribución de respuestas</h2>
                <div className="dn">
                  <svg
                    width="104"
                    height="104"
                    viewBox="0 0 42 42"
                    id="dSeg"
                  >
                    <circle
                      cx="21"
                      cy="21"
                      r="15.9"
                      fill="none"
                      stroke="var(--grid)"
                      strokeWidth="6"
                    />
                    {donutSegs.map((seg) => (
                      <circle
                        key={seg.k}
                        className="sg"
                        cx="21"
                        cy="21"
                        r="15.9"
                        fill="none"
                        stroke={donutColors[seg.k]}
                        strokeWidth="6"
                        strokeDasharray={`${seg.v} ${100 - seg.v}`}
                        strokeDashoffset={seg.off}
                      />
                    ))}
                  </svg>
                  <div className="dl">
                    <div>
                      <i style={{ background: "var(--good)" }} />
                      Cumple
                      <b>{result.cnt.C}</b>
                    </div>
                    <div>
                      <i style={{ background: "var(--warn)" }} />
                      Parcial
                      <b>{result.cnt.P}</b>
                    </div>
                    <div>
                      <i style={{ background: "var(--crit)" }} />
                      No cumple
                      <b>{result.cnt.NC}</b>
                    </div>
                    <div>
                      <i style={{ background: "var(--ink3)" }} />
                      No aplica
                      <b>{result.cnt.NA}</b>
                    </div>
                    <div style={{ color: "var(--ink3)" }}>
                      <i style={{ background: "var(--grid)" }} />
                      Pendiente
                      <b>{result.tot - result.ev}</b>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <h2>Semáforo por bloque</h2>
                {result.bl.map((b) => {
                  const pc = b.pct == null ? null : Math.round(b.pct);
                  const z = verdictScale(pc);
                  return (
                    <div
                      key={b.l}
                      className="blk"
                      title={`Aporta ${round1(b.pts)} de ${b.ap} puntos al global`}
                      onClick={() => scrollToBlock(b.l)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          scrollToBlock(b.l);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span
                        className="dot"
                        style={{ background: b.a }}
                      />
                      <span className="nm">
                        {b.l}. {b.t}
                        <small>peso {b.peso}%</small>
                      </span>
                      <span className="tr">
                        <i
                          style={{
                            width: `${pc || 0}%`,
                            background: z.c,
                          }}
                        />
                      </span>
                      <span
                        className="pc"
                        style={{
                          color: pc == null ? "var(--ink3)" : z.c,
                        }}
                      >
                        {pc == null ? "—" : `${pc}%`}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="card no-p">
                <h2>Escala</h2>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: "var(--ink2)",
                    lineHeight: 1.8,
                  }}
                >
                  <span
                    className="bg"
                    style={{
                      background: "rgba(12,163,12,.14)",
                      color: "#0a7d0a",
                    }}
                  >
                    ≥ 90% Cumple
                  </span>{" "}
                  <span
                    className="bg"
                    style={{
                      background: "rgba(250,178,25,.22)",
                      color: "#8a5c00",
                    }}
                  >
                    75–89% Mejorar
                  </span>{" "}
                  <span
                    className="bg"
                    style={{
                      background: "rgba(236,131,90,.22)",
                      color: "#a4491f",
                    }}
                  >
                    60–74% Deficiente
                  </span>{" "}
                  <span
                    className="bg"
                    style={{
                      background: "rgba(208,59,59,.14)",
                      color: "var(--crit)",
                    }}
                  >
                    &lt; 60% Crítico
                  </span>
                  <div style={{ marginTop: 9 }}>
                    C = 100% del peso · P = 50% · NC = 0%.
                    <br />
                    Los {totalPtsLabel} puntos suman <b>100%</b>; lo pendiente
                    cuenta como 0, por eso el global sube a medida que avanza.
                    <br />
                    El <b>N/A</b> sale del peso y se reparte entre los demás.
                    <br />
                    <span className="star" style={{ marginLeft: 0 }}>
                      CRÍTICO
                    </span>{" "}
                    uno solo en NC deja la sede <b>No conforme</b>.
                  </div>
                </div>
              </div>
            </aside>
          </div>

          <div className="card" style={{ marginBottom: 60 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <h2 style={{ margin: 0 }}>Plan de acción</h2>
              <span style={{ fontSize: 12, color: "var(--ink3)" }}>
                causa raíz · acción correctiva · responsable · plazo · cierre
              </span>
              <span className="sp" />
              <button
                type="button"
                className="btn no-p"
                style={{ padding: "6px 12px", fontSize: "12.5px" }}
                onClick={exportPlanCsv}
              >
                Descargar plan
              </button>
            </div>

            {actionItems.length > 0 && (
              <>
                <div
                  className="kpis"
                  style={{
                    gridTemplateColumns: "repeat(5, 1fr)",
                    margin: "0 0 14px",
                  }}
                >
                  <div className="kp k1">
                    <b style={{ color: "var(--crit)" }}>{p1}</b>
                    <span>P1 · 24 horas</span>
                  </div>
                  <div className="kp k2">
                    <b style={{ color: "#a4491f" }}>{p2}</b>
                    <span>P2 · 7 días</span>
                  </div>
                  <div
                    className="kp k2"
                    style={{
                      background:
                        "linear-gradient(160deg,rgba(250,178,25,.13),transparent)",
                    }}
                  >
                    <b style={{ color: "#8a5c00" }}>{p3}</b>
                    <span>P3 · 15 días</span>
                  </div>
                  <div className="kp k4">
                    <b style={{ color: "var(--good)" }}>
                      {closedActions.length}/{actionItems.length}
                    </b>
                    <span>Cerradas</span>
                  </div>
                  <div className="kp k3">
                    <b style={{ color: "var(--s1)" }}>
                      +{round1(recPts)}
                    </b>
                    <span>Puntos por recuperar</span>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--ink2)",
                    marginBottom: 12,
                    padding: "10px 13px",
                    borderRadius: 11,
                    background: "var(--page)",
                  }}
                >
                  Con el plan cerrado y verificado, la sede pasa de{" "}
                  <b>{round1(result.pct ?? 0)}%</b> a{" "}
                  <b style={{ color: "var(--good)" }}>
                    {round1(proy ?? 0)}%
                  </b>{" "}
                  · <b>{openActions.length}</b> acción(es) abierta(s)
                  {ganPts
                    ? ` · ${round1(ganPts)} pts cerrados pendientes de verificar`
                    : ""}
                  {vencidas ? (
                    <span
                      style={{ color: "var(--crit)", fontWeight: 800 }}
                    >
                      {" "}
                      · {vencidas} VENCIDA(S)
                    </span>
                  ) : null}
                  {p1 ? (
                    <span
                      style={{ color: "var(--crit)", fontWeight: 800 }}
                    >
                      {" "}
                      · {p1} de cierre inmediato
                    </span>
                  ) : null}
                </div>
              </>
            )}

            {!actionItems.length ? (
              <div className="empty">
                Sin hallazgos: no hay acciones por abrir. El plan se llena solo
                cuando marca un punto en <b>No cumple</b> o <b>Parcial</b>.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 1120 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 96 }}>Prioridad</th>
                      <th style={{ width: 34 }}>#</th>
                      <th style={{ width: "19%" }}>Hallazgo</th>
                      <th style={{ width: "15%" }}>Causa raíz</th>
                      <th style={{ width: "25%" }}>Acción correctiva</th>
                      <th style={{ width: "12%" }}>Responsable</th>
                      <th style={{ width: 118 }}>Fecha límite</th>
                      <th style={{ width: 136 }}>Estado</th>
                      <th className="n" style={{ width: 64 }}>
                        Puntos
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionItems.map((a) => {
                      const P = PRIORITY_META[a.pr];
                      const c = a.it.c;
                      const E2 = ESTADO_META[a.s.es] || ESTADO_META.Pendiente;
                      const venc =
                        a.s.es !== "Cerrada" && a.s.f && a.s.f < hoy;
                      return (
                        <tr
                          key={c}
                          data-pa={c}
                          style={{
                            borderLeft: `4px solid ${P.c}`,
                            opacity: a.s.es === "Cerrada" ? 0.62 : 1,
                          }}
                        >
                          <td>
                            <span
                              className="bg"
                              style={{
                                background: P.bg,
                                color: P.fg,
                              }}
                            >
                              {P.l}
                            </span>
                            <div
                              style={{
                                fontSize: "10.5px",
                                color: "var(--ink3)",
                                marginTop: 3,
                              }}
                            >
                              {P.d === 1 ? "24 horas" : `${P.d} días`}
                            </div>
                          </td>
                          <td className="n">
                            <span
                              className="qn"
                              style={
                                {
                                  "--acc": a.block.a,
                                  background: `color-mix(in srgb, ${a.block.a} 16%, transparent)`,
                                  color: a.block.a,
                                } as CSSProperties
                              }
                            >
                              {c}
                            </span>
                            <div
                              style={{
                                fontSize: 10,
                                color: "var(--ink3)",
                                marginTop: 3,
                              }}
                            >
                              {a.s.v === "NC" ? "NC" : "Parcial"}
                            </div>
                          </td>
                          <td>
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--ink3)",
                                marginBottom: 3,
                              }}
                            >
                              {a.it.x}
                            </div>
                            <textarea
                              rows={2}
                              className="pi"
                              placeholder="Qué se encontró"
                              value={a.s.h}
                              onChange={(e) =>
                                patchState(c, "h", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <textarea
                              rows={2}
                              className="pi"
                              placeholder="Por qué ocurrió"
                              value={a.s.cz}
                              onChange={(e) =>
                                patchState(c, "cz", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <textarea
                              rows={3}
                              className="pi"
                              value={a.s.ac}
                              onChange={(e) =>
                                patchState(c, "ac", e.target.value)
                              }
                            />
                            <button
                              type="button"
                              className="kt"
                              style={{ color: a.block.a }}
                              onClick={() =>
                                patchState(c, "ac", a.it.ac)
                              }
                            >
                              restaurar sugerida
                            </button>
                          </td>
                          <td>
                            <input
                              className="pi"
                              placeholder="Quién"
                              value={a.s.r}
                              onChange={(e) =>
                                patchState(c, "r", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="pi"
                              type="date"
                              value={a.s.f}
                              onChange={(e) =>
                                patchState(c, "f", e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <select
                              className="pi"
                              style={{
                                minWidth: 118,
                                background: E2.bg,
                                color: E2.fg,
                                fontWeight: 800,
                              }}
                              value={a.s.es}
                              onChange={(e) =>
                                patchState(
                                  c,
                                  "es",
                                  e.target.value as ChecklistItemState["es"],
                                )
                              }
                            >
                              {(
                                [
                                  "Pendiente",
                                  "En proceso",
                                  "Cerrada",
                                ] as const
                              ).map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                            <div
                              className="venc"
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                color: "var(--crit)",
                                marginTop: 3,
                              }}
                            >
                              {venc ? "VENCIDA" : ""}
                            </div>
                          </td>
                          <td className="n">
                            <b style={{ color: P.c }}>
                              +{round1(a.juego)}
                            </b>
                            <div
                              style={{
                                fontSize: 10,
                                color: "var(--ink3)",
                              }}
                            >
                              de {a.it.p}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ——— Comparativo ——— */}
        <div
          id="tc"
          className={tab === "c" ? undefined : "hide"}
          style={{ padding: "18px 0 60px" }}
        >
          <div className="card">
            <h2>Comparativo de sedes</h2>
            <p className="hint">
              Cargue los archivos guardados de cada sede (puede seleccionar
              varios) para ver el ranking de la red y los bloques más débiles.
            </p>
            <div className="bar no-p">
              <button
                type="button"
                className="btn p"
                onClick={() => consFileRef.current?.click()}
              >
                Cargar auditorías
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setCons([])}
              >
                Limpiar
              </button>
              <button type="button" className="btn" onClick={exportConsCsv}>
                Descargar comparativo
              </button>
              <input
                ref={consFileRef}
                type="file"
                accept=".json"
                multiple
                className="hide"
                onChange={importCons}
              />
            </div>
            {!consRows.length ? (
              <div className="empty">Aún no ha cargado auditorías.</div>
            ) : (
              <>
                <div
                  className="kpis"
                  style={{
                    gridTemplateColumns: "repeat(4, 1fr)",
                    margin: "0 0 15px",
                  }}
                >
                  <div className="kp k3">
                    <b style={{ color: "var(--s1)" }}>
                      {Math.round(consProm)}%
                    </b>
                    <span>Promedio red</span>
                  </div>
                  <div className="kp k4">
                    <b style={{ color: "var(--s3)" }}>
                      {consRows.length}
                    </b>
                    <span>Sedes cargadas</span>
                  </div>
                  <div className="kp k1">
                    <b style={{ color: "var(--crit)" }}>
                      {consRows.filter((r) => r.c > 0).length}
                    </b>
                    <span>No conformes</span>
                  </div>
                  <div className="kp k2">
                    <b style={{ color: "#8a5c00", fontSize: 16 }}>
                      {consRows[0]?.s}
                    </b>
                    <span>Mejor sede</span>
                  </div>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Empresa</th>
                      <th>Sede</th>
                      <th>Fecha</th>
                      <th style={{ width: "32%" }}>Cumplimiento</th>
                      <th>Estado</th>
                      <th className="n">Crít.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consRows.map((r, i) => {
                      const p = Math.round(r.p);
                      const z = verdictScale(p);
                      return (
                        <tr key={`${r.e}-${r.s}-${r.f}-${i}`}>
                          <td>
                            <span
                              className="medal"
                              style={{
                                background:
                                  i < 3 ? MEDAL[i] : "var(--axis)",
                              }}
                            >
                              {i + 1}
                            </span>
                          </td>
                          <td>{r.e}</td>
                          <td>
                            <b>{r.s}</b>
                          </td>
                          <td>{r.f}</td>
                          <td>
                            <div className="rb">
                              <div className="t">
                                <i
                                  style={{
                                    width: `${p}%`,
                                    background: z.c,
                                  }}
                                />
                              </div>
                              <span
                                className="v"
                                style={{ color: z.c }}
                              >
                                {p}%
                              </span>
                            </div>
                          </td>
                          <td>
                            <span
                              className="bg"
                              style={{
                                background:
                                  r.c > 0
                                    ? "rgba(208,59,59,.14)"
                                    : z.bg,
                                color: r.c > 0 ? "var(--crit)" : z.fg,
                              }}
                            >
                              {r.c > 0 ? "No conforme" : z.l}
                            </span>
                          </td>
                          <td className="n">{r.c}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {networkFocus.length > 0 && (
                  <>
                    <h2 style={{ margin: "22px 0 8px" }}>
                      Focos de mejora de la red
                    </h2>
                    <table>
                      <thead>
                        <tr>
                          <th>Bloque</th>
                          <th>Foco de mejora de la red</th>
                          <th style={{ width: "38%" }}>Promedio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {networkFocus.map((b) => {
                          const p = Math.round(b.p);
                          const z = verdictScale(p);
                          return (
                            <tr key={b.l}>
                              <td>
                                <span
                                  className="medal"
                                  style={{
                                    background: b.a || "var(--axis)",
                                  }}
                                >
                                  {b.l}
                                </span>
                              </td>
                              <td>{b.t}</td>
                              <td>
                                <div className="rb">
                                  <div className="t">
                                    <i
                                      style={{
                                        width: `${p}%`,
                                        background: z.c,
                                      }}
                                    />
                                  </div>
                                  <span
                                    className="v"
                                    style={{ color: z.c }}
                                  >
                                    {p}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* ——— Config ——— */}
        <div
          id="tg"
          className={tab === "g" ? undefined : "hide"}
          style={{ padding: "18px 0 60px" }}
        >
          <div className="card">
            <h2>Empresas y sedes</h2>
            <p className="hint">
              Estructura precargada. Al cambiar de empresa, el selector muestra
              solo sus sedes.
            </p>
            <div className="g2">
              {cfg.map((g, i) => (
                <div
                  key={`cfg-${i}`}
                  style={{
                    background: "var(--page)",
                    borderRadius: 12,
                    padding: 12,
                    borderTop: `4px solid ${CFG_COLORS[i % 6]}`,
                  }}
                >
                  <div className="cfg">
                    <input
                      value={g.empresa}
                      style={{ fontWeight: 700 }}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCfg((prev) => {
                          const next = structuredClone(prev);
                          next[i].empresa = v;
                          return next;
                        });
                        setMeta((m) =>
                          m.empresa === g.empresa
                            ? { ...m, empresa: v }
                            : m,
                        );
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setCfg((prev) => prev.filter((_, j) => j !== i));
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <div className="sl">
                    {g.sedes.map((s, j) => (
                      <div className="cfg s" key={`sede-${i}-${j}`}>
                        <input
                          value={s}
                          onChange={(e) => {
                            const v = e.target.value;
                            setCfg((prev) => {
                              const next = structuredClone(prev);
                              next[i].sedes[j] = v;
                              return next;
                            });
                            setMeta((m) =>
                              m.sede === s ? { ...m, sede: v } : m,
                            );
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setCfg((prev) => {
                              const next = structuredClone(prev);
                              next[i].sedes.splice(j, 1);
                              return next;
                            });
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      marginLeft: 18,
                      padding: "4px 10px",
                      fontSize: 12,
                    }}
                    onClick={() => {
                      setCfg((prev) => {
                        const next = structuredClone(prev);
                        next[i].sedes.push("Nueva sede");
                        return next;
                      });
                    }}
                  >
                    + sede
                  </button>
                </div>
              ))}
            </div>
            <div className="bar" style={{ marginTop: 13 }}>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setCfg((prev) => [
                    ...prev,
                    { empresa: "Nueva empresa", sedes: ["Nueva sede"] },
                  ])
                }
              >
                + Empresa
              </button>
              <button type="button" className="btn p" onClick={exportCfg}>
                Descargar configuración
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => cfgFileRef.current?.click()}
              >
                Cargar configuración
              </button>
              <input
                ref={cfgFileRef}
                type="file"
                accept=".json"
                className="hide"
                onChange={importCfg}
              />
            </div>
          </div>

          <div className="card">
            <h2>Pesos de la calificación</h2>
            <p className="hint">
              Defina cuánto vale cada punto sobre el 100%. El peso del bloque es
              la suma de sus preguntas. Si el total no da 100%, use «Normalizar»
              y el sistema lo ajusta proporcionalmente.
            </p>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }} />
                  <th>Punto de control</th>
                  <th style={{ width: 110 }}>Peso %</th>
                  <th style={{ width: 150 }}>Participación</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((b) => {
                  const pb = b.q.reduce((a, x) => a + x.p, 0);
                  return (
                    <Fragment key={b.l}>
                      <tr
                        style={{
                          background: `color-mix(in srgb, ${b.a} 10%, transparent)`,
                        }}
                      >
                        <td>
                          <span
                            className="medal"
                            style={{ background: b.a }}
                          >
                            {b.l}
                          </span>
                        </td>
                        <td>
                          <b>{b.t}</b>
                        </td>
                        <td className="n">
                          <b style={{ color: b.a }}>{round1(pb)}%</b>
                        </td>
                        <td>
                          <div className="rb">
                            <div className="t">
                              <i
                                style={{
                                  width: `${pesosTot ? (pb / pesosTot) * 100 : 0}%`,
                                  background: b.a,
                                }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                      {b.q.map((it) => (
                        <tr key={it.c}>
                          <td
                            className="n"
                            style={{
                              color: "var(--ink3)",
                              fontSize: "11.5px",
                            }}
                          >
                            {it.c}
                          </td>
                          <td style={{ paddingLeft: 16 }}>
                            {it.x}
                            {it.w === 3 && (
                              <span className="star">CRÍTICO</span>
                            )}
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={it.p}
                              style={{
                                width: 78,
                                padding: "5px 8px",
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                background: "var(--page)",
                                textAlign: "right",
                              }}
                              onChange={(e) =>
                                setPeso(it.c, e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <div className="rb">
                              <div className="t">
                                <i
                                  style={{
                                    width: `${pesosTot ? (it.p / pesosTot) * 100 : 0}%`,
                                    background: b.a,
                                    opacity: 0.55,
                                  }}
                                />
                              </div>
                              <span
                                className="v"
                                style={{ color: "var(--ink3)" }}
                              >
                                {pesosTot
                                  ? ((it.p / pesosTot) * 100).toFixed(1)
                                  : 0}
                                %
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <div
              style={{
                marginTop: 11,
                padding: "10px 13px",
                borderRadius: 11,
                fontSize: 13,
                fontWeight: 700,
                background: pesosOk
                  ? "rgba(12,163,12,.12)"
                  : "rgba(250,178,25,.20)",
                color: pesosOk ? "#0a7d0a" : "#8a5c00",
              }}
            >
              Total: {round1(pesosTot)}%{" "}
              {pesosOk
                ? "— correcto"
                : "— debe sumar 100%; use «Normalizar»"}
            </div>
            <div className="bar" style={{ marginTop: 13 }}>
              <button type="button" className="btn" onClick={doNormalize}>
                Normalizar a 100%
              </button>
              <button type="button" className="btn" onClick={resetPesos}>
                Restaurar pesos sugeridos
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`toast${toastOn ? " on" : ""}`}>{toastMsg}</div>
    </div>
  );
}
