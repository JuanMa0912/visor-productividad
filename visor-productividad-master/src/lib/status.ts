import { Linekey } from "@/types";

type Thresholds = {
  excellent: number;
  normal: number;
  attention: number;
};

type StatusConfig = {
  summary: Thresholds;
  line: Thresholds;
  lineOverrides?: Partial<Record<Linekey, Thresholds>>;
};

const defaultConfig: StatusConfig = {
  summary: {
    excellent: 1200000,
    normal: 0,
    attention: -400000,
  },
  line: {
    excellent: 500000,
    normal: 0,
    attention: -200000,
  },
};

const statusConfigBySede: Record<string, StatusConfig> = {
  floresta: {
    summary: {
      excellent: 1200000,
      normal: 0,
      attention: -400000,
    },
    line: {
      excellent: 500000,
      normal: 0,
      attention: -200000,
    },
  },
};

const summaryLabels = {
  excellent: "Día sólido",
  normal: "Día estable",
  attention: "Revisar",
  problem: "Crítico",
};

const lineLabels = {
  excellent: "Excelente",
  normal: "Normal",
  attention: "Atención",
  problem: "Problema",
};

const statusClasses = {
  excellent: "bg-emerald-100 text-emerald-700",
  normal: "bg-slate-200 text-slate-700",
  attention: "bg-amber-100 text-amber-700",
  problem: "bg-rose-100 text-rose-700",
};

export const getSummaryStatus = (sede: string, margin: number) => {
  const thresholds = statusConfigBySede[sede]?.summary ?? defaultConfig.summary;
  return resolveStatus(margin, thresholds, summaryLabels);
};

export const getLineStatus = (
  sede: string,
  lineId: Linekey,
  margin: number
) => {
  const sedeConfig = statusConfigBySede[sede] ?? defaultConfig;
  const thresholds = sedeConfig.lineOverrides?.[lineId] ?? sedeConfig.line;
  return resolveStatus(margin, thresholds, lineLabels);
};

const resolveStatus = (
  margin: number,
  thresholds: Thresholds,
  labels: typeof summaryLabels
) => {
  if (margin >= thresholds.excellent) {
    return {
      label: labels.excellent,
      className: statusClasses.excellent,
      textClass: "text-emerald-600",
    };
  }
  if (margin >= thresholds.normal) {
    return {
      label: labels.normal,
      className: statusClasses.normal,
      textClass: "text-slate-700",
    };
  }
  if (margin >= thresholds.attention) {
    return {
      label: labels.attention,
      className: statusClasses.attention,
      textClass: "text-amber-600",
    };
  }
  return {
    label: labels.problem,
    className: statusClasses.problem,
    textClass: "text-rose-600",
  };
};


