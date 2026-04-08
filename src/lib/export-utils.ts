export const formatPdfDate = () =>
  new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

export const sanitizeExportText = (value: string) => {
  const normalized = value.replace(/\r?\n/g, " ").trim();
  return /^[=+\-@\t]/.test(normalized) ? `'${normalized}` : normalized;
};

export const escapeCsvValue = (value: string | number) => {
  const str =
    typeof value === "string" ? sanitizeExportText(value) : String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};
