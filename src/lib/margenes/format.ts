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
