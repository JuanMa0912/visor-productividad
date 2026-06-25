export const formatMiles = (value: number): string =>
  (value / 1000).toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

export const formatPercent = (value: number): string =>
  `${value.toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;

export const formatPesos = (value: number): string =>
  value.toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

export const formatDecimals = (value: number, digits = 2): string =>
  value.toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });

export const marginToneClass = (pct: number): string => {
  if (pct >= 15) return "text-[#34d399]";
  if (pct >= 5) return "text-[#fbbf24]";
  return "text-[#f87171]";
};

export const marginBadgeClass = (pct: number): string => {
  if (pct >= 15) return "bg-[#34d399]/15 text-[#34d399]";
  if (pct >= 5) return "bg-[#fbbf24]/15 text-[#fbbf24]";
  return "bg-[#f87171]/15 text-[#f87171]";
};
