import type {
  ChecklistAnswer,
  ChecklistBlock,
  ChecklistComputeResult,
  ChecklistItemState,
  ChecklistQuestion,
} from "@/lib/checklists/types";
import { ANSWER_FACTOR, emptyItemState } from "@/lib/checklists/types";

export const initStates = (
  blocks: ChecklistBlock[],
): Record<number, ChecklistItemState> => {
  const out: Record<number, ChecklistItemState> = {};
  for (const block of blocks) {
    for (const q of block.q) out[q.c] = emptyItemState();
  }
  return out;
};

export const cloneBlocksWithPesos = (
  blocks: ChecklistBlock[],
  pesos?: Record<number, number> | null,
): ChecklistBlock[] =>
  blocks.map((block) => ({
    ...block,
    q: block.q.map((item) => ({
      ...item,
      p: pesos && pesos[item.c] != null ? Number(pesos[item.c]) : item.p,
    })),
  }));

export const computeChecklist = (
  blocks: ChecklistBlock[],
  states: Record<number, ChecklistItemState>,
): ChecklistComputeResult => {
  let p = 0;
  let po = 0;
  let pend = 0;
  let ev = 0;
  let cr = 0;
  let hl = 0;
  let tot = 0;
  const bl: ChecklistComputeResult["bl"] = [];
  const cnt: Record<ChecklistAnswer, number> = { C: 0, P: 0, NC: 0, NA: 0 };

  for (const block of blocks) {
    let sp = 0;
    let spo = 0;
    let se = 0;
    let pb = 0;
    for (const it of block.q) {
      tot += 1;
      pb += it.p;
      const s = states[it.c] ?? emptyItemState();
      if (s.v) {
        ev += 1;
        se += 1;
        cnt[s.v] += 1;
        if (s.v === "P" || s.v === "NC") hl += 1;
        if (s.v === "NC" && it.w === 3) cr += 1;
      }
      if (s.v === "NA") continue;
      spo += it.p;
      if (s.v === "C" || s.v === "P" || s.v === "NC") {
        sp += ANSWER_FACTOR[s.v] * it.p;
      } else {
        pend += it.p;
      }
    }
    p += sp;
    po += spo;
    bl.push({
      l: block.l,
      t: block.t,
      a: block.a,
      peso: pb,
      ap: spo,
      pts: sp,
      pct: spo ? (sp / spo) * 100 : null,
      ev: se,
      n: block.q.length,
    });
  }

  return {
    p,
    po,
    pend,
    ev,
    tot,
    cr,
    hl,
    bl,
    cnt,
    pct: po ? (p / po) * 100 : null,
    max: po ? ((p + pend) / po) * 100 : null,
  };
};

export const verdictScale = (pct: number | null) => {
  if (pct == null) {
    return {
      c: "var(--axis)",
      g: ["#c3c2b7", "#c3c2b7"] as [string, string],
      bg: "transparent",
      fg: "var(--ink2)",
      l: "Sin evaluar",
    };
  }
  if (pct >= 90) {
    return {
      c: "var(--good)",
      g: ["#1baf7a", "#0ca30c"] as [string, string],
      bg: "rgba(12,163,12,.14)",
      fg: "#0a7d0a",
      l: "Cumple",
    };
  }
  if (pct >= 75) {
    return {
      c: "var(--warn)",
      g: ["#eda100", "#fab219"] as [string, string],
      bg: "rgba(250,178,25,.22)",
      fg: "#8a5c00",
      l: "Requiere mejora",
    };
  }
  if (pct >= 60) {
    return {
      c: "var(--ser)",
      g: ["#eb6834", "#ec835a"] as [string, string],
      bg: "rgba(236,131,90,.22)",
      fg: "#a4491f",
      l: "Deficiente",
    };
  }
  return {
    c: "var(--crit)",
    g: ["#d03b3b", "#e34948"] as [string, string],
    bg: "rgba(208,59,59,.14)",
    fg: "var(--crit)",
    l: "Crítico",
  };
};

export const priorityOf = (it: ChecklistQuestion, v: ChecklistAnswer) => {
  if (v === "NC" && it.w === 3) return 1;
  if (v === "NC") return 2;
  if (it.w === 3) return 2;
  return 3;
};

export const PRIORITY_META = {
  1: {
    l: "P1 · Inmediata",
    d: 1,
    c: "var(--crit)",
    bg: "rgba(208,59,59,.14)",
    fg: "var(--crit)",
  },
  2: {
    l: "P2 · Alta",
    d: 7,
    c: "var(--ser)",
    bg: "rgba(236,131,90,.20)",
    fg: "#a4491f",
  },
  3: {
    l: "P3 · Media",
    d: 15,
    c: "var(--warn)",
    bg: "rgba(250,178,25,.22)",
    fg: "#8a5c00",
  },
} as const;

export const ESTADO_META = {
  Pendiente: { bg: "rgba(208,59,59,.12)", fg: "var(--crit)" },
  "En proceso": { bg: "rgba(250,178,25,.20)", fg: "#8a5c00" },
  Cerrada: { bg: "rgba(12,163,12,.14)", fg: "#0a7d0a" },
} as const;

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4)
    .toISOString()
    .slice(0, 10);
};

export const addDaysISO = (iso: string, n: number) => {
  const base = iso ? new Date(`${iso}T00:00:00`) : new Date();
  base.setDate(base.getDate() + n);
  return new Date(base.getTime() - base.getTimezoneOffset() * 6e4)
    .toISOString()
    .slice(0, 10);
};

export const listActionItems = (
  blocks: ChecklistBlock[],
  states: Record<number, ChecklistItemState>,
) => {
  const rows: Array<{
    block: ChecklistBlock;
    it: ChecklistQuestion;
    s: ChecklistItemState;
    pr: 1 | 2 | 3;
    juego: number;
  }> = [];
  for (const block of blocks) {
    for (const it of block.q) {
      const s = states[it.c] ?? emptyItemState();
      if (s.v !== "NC" && s.v !== "P") continue;
      const pr = priorityOf(it, s.v) as 1 | 2 | 3;
      rows.push({
        block,
        it,
        s,
        pr,
        juego: it.p * (1 - ANSWER_FACTOR[s.v]),
      });
    }
  }
  return rows.sort((a, b) => a.pr - b.pr || b.juego - a.juego);
};

export const normalizePesos = (blocks: ChecklistBlock[]): ChecklistBlock[] => {
  const tot = blocks.reduce(
    (acc, b) => acc + b.q.reduce((x, y) => x + y.p, 0),
    0,
  );
  if (!tot) return blocks;
  const next = blocks.map((b) => ({
    ...b,
    q: b.q.map((it) => ({
      ...it,
      p: Math.round((it.p / tot) * 1000) / 10,
    })),
  }));
  const sum = next.reduce((a, b) => a + b.q.reduce((x, y) => x + y.p, 0), 0);
  const diff = 100 - sum;
  if (next[0]?.q[0]) {
    next[0] = {
      ...next[0],
      q: next[0].q.map((it, i) =>
        i === 0 ? { ...it, p: Math.round((it.p + diff) * 10) / 10 } : it,
      ),
    };
  }
  return next;
};
