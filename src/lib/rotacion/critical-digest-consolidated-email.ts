import type { RotacionCriticalDigest } from "@/lib/rotacion/critical-digest";
import {
  formatPrice,
  formatRangeLabel,
  LINEA_N1_FAMILY_LABELS,
} from "@/app/rotacion/rotacion-preamble";

/** Monto completo en pesos (igual que el correo individual). */
const formatInventario = (value: number) => formatPrice(value);

const formatCount = (value: number) =>
  value.toLocaleString("es-CO", { maximumFractionDigits: 0 });

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatScore = (digest: RotacionCriticalDigest): string => {
  const eff = digest.restockEffectiveness;
  if (eff.unavailable || eff.score == null) return "—";
  return String(eff.score);
};

/** 0 y S no dependen de ABCD; D se deriva para cuadrar con total sede. */
const sedeCriticalBreakdown = (digest: RotacionCriticalDigest) => {
  const cero =
    digest.perecederos.ceroRotacion.itemCount +
    digest.manufactura.ceroRotacion.itemCount;
  const restockS =
    digest.perecederos.restockS.itemCount +
    digest.manufactura.restockS.itemCount;
  const demandaD = Math.max(0, digest.total.itemCount - cero - restockS);
  return { demandaD, cero, restockS };
};

export type ConsolidatedDigestTotals = {
  itemCount: number;
  totalInventario: number;
  demandaD: number;
  cero: number;
  restockS: number;
  restockScore: number | null;
  restockMarked: number;
  restockSold: number;
};

export const aggregateConsolidatedDigestTotals = (
  digests: readonly RotacionCriticalDigest[],
): ConsolidatedDigestTotals => {
  let itemCount = 0;
  let totalInventario = 0;
  let demandaD = 0;
  let cero = 0;
  let restockS = 0;
  let restockMarked = 0;
  let restockSold = 0;

  for (const digest of digests) {
    itemCount += digest.total.itemCount;
    totalInventario += digest.total.totalInventario;
    const breakdown = sedeCriticalBreakdown(digest);
    demandaD += breakdown.demandaD;
    cero += breakdown.cero;
    restockS += breakdown.restockS;
    const eff = digest.restockEffectiveness;
    if (eff.unavailable) continue;
    restockMarked += eff.markedSurtidoCount;
    restockSold += eff.soldAfterCount;
  }

  const restockScore =
    restockMarked > 0
      ? Math.round((restockSold / restockMarked) * 100)
      : null;

  return {
    itemCount,
    totalInventario,
    demandaD,
    cero,
    restockS,
    restockScore,
    restockMarked,
    restockSold,
  };
};

const th = (
  label: string,
  align: "left" | "right" | "center" = "left",
  accent = "#9f1239",
  border = "#fecdd3",
) =>
  `<th style="padding:8px 8px;border-bottom:2px solid ${border};font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${accent};text-align:${align};white-space:nowrap;">${label}</th>`;

const td = (
  content: string,
  align: "left" | "right" | "center" = "left",
  extra = "",
) =>
  `<td style="padding:9px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;text-align:${align};vertical-align:middle;${extra}">${content}</td>`;

const buildOverviewRows = (digests: readonly RotacionCriticalDigest[]) =>
  digests
    .map((digest, index) => {
      const bg = index % 2 === 0 ? "#ffffff" : "#fff7f8";
      const { demandaD: dCount, cero: ceroCount, restockS: sCount } =
        sedeCriticalBreakdown(digest);
      return `<tr style="background:${bg};">
        ${td(`<strong>${escapeHtml(digest.sedeName)}</strong>`)}
        ${td(formatScore(digest), "center", "font-weight:800;")}
        ${td(formatCount(digest.total.itemCount), "right", "font-variant-numeric:tabular-nums;")}
        ${td(
          formatInventario(digest.total.totalInventario),
          "right",
          "font-size:16px;font-weight:800;color:#be123c;font-variant-numeric:tabular-nums;",
        )}
        ${td(formatCount(dCount), "right", "font-variant-numeric:tabular-nums;color:#9f1239;")}
        ${td(formatCount(ceroCount), "right", "font-variant-numeric:tabular-nums;color:#475569;")}
        ${td(formatCount(sCount), "right", "font-variant-numeric:tabular-nums;color:#0e7490;")}
      </tr>`;
    })
    .join("");

const buildFamilyRows = (digests: readonly RotacionCriticalDigest[]) =>
  digests
    .map((digest, index) => {
      const bg = index % 2 === 0 ? "#ffffff" : "#f8fafc";
      const per = digest.perecederos.total;
      const man = digest.manufactura.total;
      return `<tr style="background:${bg};">
        ${td(`<strong>${escapeHtml(digest.sedeName)}</strong>`)}
        ${td(formatCount(per.itemCount), "right", "font-variant-numeric:tabular-nums;")}
        ${td(
          formatInventario(per.totalInventario),
          "right",
          "font-weight:700;color:#047857;font-variant-numeric:tabular-nums;",
        )}
        ${td(formatCount(man.itemCount), "right", "font-variant-numeric:tabular-nums;")}
        ${td(
          formatInventario(man.totalInventario),
          "right",
          "font-weight:700;color:#1d4ed8;font-variant-numeric:tabular-nums;",
        )}
      </tr>`;
    })
    .join("");

export const buildRotacionCriticalDigestConsolidatedSubject = (
  digests: readonly RotacionCriticalDigest[],
) => {
  const range =
    digests[0]?.dateRange ??
    ({ start: "", end: "" } as RotacionCriticalDigest["dateRange"]);
  const rangeLabel =
    range.start && range.end ? formatRangeLabel(range) : "sin rango";
  return `Rotación · Todas las sedes · Críticos D+0+S · ${rangeLabel}`;
};

export const buildRotacionCriticalDigestConsolidatedHtml = (
  digests: readonly RotacionCriticalDigest[],
) => {
  if (digests.length === 0) {
    return `<!DOCTYPE html><html lang="es"><body><p>Sin sedes con datos.</p></body></html>`;
  }

  const range = digests[0]!.dateRange;
  const rangeLabel = formatRangeLabel(range);
  const days = digests[0]!.daysConsulted;
  const totals = aggregateConsolidatedDigestTotals(digests);
  const scoreLabel =
    totals.restockScore == null
      ? "—"
      : `${totals.restockScore}`;
  const scoreDetail =
    totals.restockMarked > 0
      ? `${formatCount(totals.restockSold)} de ${formatCount(totals.restockMarked)} vendieron tras surtido`
      : "Sin marcas a surtido (restock) en el periodo";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rotación · Todas las sedes</title>
</head>
<body style="margin:0;padding:12px;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <tr>
      <td style="padding:14px 16px 10px;background:#fff1f2;border-bottom:1px solid #fecdd3;">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#be123c;">Críticos · D+0+S · Cadena</div>
        <div style="margin-top:2px;font-size:20px;font-weight:800;line-height:1.2;color:#0f172a;">Todas las sedes</div>
        <div style="margin-top:2px;font-size:12px;color:#64748b;">${escapeHtml(rangeLabel)} · ${formatCount(days)} días · ${formatCount(digests.length)} sedes</div>
      </td>
    </tr>

    <tr>
      <td style="padding:12px 16px 6px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;">
          <tr>
            <td style="padding:10px 12px;">
              <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#be123c;">Total cadena D+0+S</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:6px;">
                <tr>
                  <td style="vertical-align:top;">
                    <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Productos</div>
                    <div style="margin-top:2px;font-size:18px;font-weight:800;color:#0f172a;">${formatCount(totals.itemCount)}</div>
                  </td>
                  <td style="vertical-align:top;text-align:right;">
                    <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Inventario</div>
                    <div style="margin-top:2px;font-size:22px;font-weight:800;color:#be123c;">${formatInventario(totals.totalInventario)}</div>
                  </td>
                </tr>
              </table>
              <div style="margin-top:8px;padding-top:8px;border-top:1px solid #fecdd3;font-size:12px;color:#475569;">
                Restock cadena: <strong style="color:#155e75;font-size:16px;">${scoreLabel}</strong>
                <span style="color:#64748b;"> · ${escapeHtml(scoreDetail)}</span>
                <span style="color:#94a3b8;"> · D ${formatCount(totals.demandaD)} · 0 ${formatCount(totals.cero)} · S ${formatCount(totals.restockS)}</span>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:10px 16px 4px;">
        <div style="font-size:11px;font-weight:800;color:#0f172a;margin-bottom:6px;">Comparativo por sede</div>
        <div style="font-size:11px;color:#64748b;margin-bottom:8px;">Mismas cifras que el correo individual (D+0+S). Inventario en rojo. Orden de sedes del portal.</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #fecdd3;border-radius:10px;overflow:hidden;">
          <thead>
            <tr style="background:#fff1f2;">
              ${th("Sede")}
              ${th("Restock", "center")}
              ${th("Productos", "right")}
              ${th("Inventario", "right")}
              ${th("D", "right")}
              ${th("0", "right")}
              ${th("S", "right")}
            </tr>
          </thead>
          <tbody>
            ${buildOverviewRows(digests)}
            <tr style="background:#ffe4e6;">
              ${td("<strong>Total</strong>")}
              ${td(scoreLabel, "center", "font-weight:800;")}
              ${td(`<strong>${formatCount(totals.itemCount)}</strong>`, "right")}
              ${td(
                `<strong>${formatInventario(totals.totalInventario)}</strong>`,
                "right",
                "font-size:16px;font-weight:800;color:#be123c;",
              )}
              ${td(`<strong>${formatCount(totals.demandaD)}</strong>`, "right")}
              ${td(`<strong>${formatCount(totals.cero)}</strong>`, "right")}
              ${td(`<strong>${formatCount(totals.restockS)}</strong>`, "right")}
            </tr>
          </tbody>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:14px 16px 6px;">
        <div style="font-size:11px;font-weight:800;color:#0f172a;margin-bottom:6px;">Desglose por familia</div>
        <div style="font-size:11px;color:#64748b;margin-bottom:8px;">${LINEA_N1_FAMILY_LABELS.perecederos} (01–04, 12) · ${LINEA_N1_FAMILY_LABELS.manufactura} (resto).</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
          <thead>
            <tr style="background:#f8fafc;">
              ${th("Sede", "left", "#475569", "#e2e8f0")}
              ${th("Perec. #", "right", "#047857", "#e2e8f0")}
              ${th("Perec. inv.", "right", "#047857", "#e2e8f0")}
              ${th("Manuf. #", "right", "#1d4ed8", "#e2e8f0")}
              ${th("Manuf. inv.", "right", "#1d4ed8", "#e2e8f0")}
            </tr>
          </thead>
          <tbody>
            ${buildFamilyRows(digests)}
          </tbody>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:10px 16px 14px;border-top:1px solid #f1f5f9;font-size:10px;line-height:1.4;color:#94a3b8;">
        Automático · Visor. Una fila por sede con la misma lógica D+0+S y restock del correo individual. Restock cadena = suma de marcas surtido / ventas posteriores en todas las sedes.
      </td>
    </tr>
  </table>
</body>
</html>`;
};

export const buildRotacionCriticalDigestConsolidatedText = (
  digests: readonly RotacionCriticalDigest[],
) => {
  if (digests.length === 0) return "Sin sedes con datos.";

  const range = digests[0]!.dateRange;
  const rangeLabel = formatRangeLabel(range);
  const days = digests[0]!.daysConsulted;
  const totals = aggregateConsolidatedDigestTotals(digests);
  const scoreLabel =
    totals.restockScore == null ? "—" : String(totals.restockScore);

  const lines = [
    `Rotación · Todas las sedes · Críticos D+0+S`,
    `Periodo: ${rangeLabel} (${formatCount(days)} días) · ${formatCount(digests.length)} sedes`,
    "",
    `TOTAL CADENA: ${formatCount(totals.itemCount)} productos · ${formatInventario(totals.totalInventario)}`,
    `Restock cadena: ${scoreLabel} (${formatCount(totals.restockSold)} de ${formatCount(totals.restockMarked)})`,
    `D ${formatCount(totals.demandaD)} · 0 ${formatCount(totals.cero)} · S ${formatCount(totals.restockS)}`,
    "",
    "SEDE | RESTOCK | PRODUCTOS | INVENTARIO | D | 0 | S",
    ...digests.map((digest) => {
      const { demandaD: dCount, cero: ceroCount, restockS: sCount } =
        sedeCriticalBreakdown(digest);
      return `${digest.sedeName} | ${formatScore(digest)} | ${formatCount(digest.total.itemCount)} | ${formatInventario(digest.total.totalInventario)} | ${formatCount(dCount)} | ${formatCount(ceroCount)} | ${formatCount(sCount)}`;
    }),
    "",
    `FAMILIA · ${LINEA_N1_FAMILY_LABELS.perecederos.toUpperCase()} | ${LINEA_N1_FAMILY_LABELS.manufactura.toUpperCase()}`,
    ...digests.map((digest) => {
      const per = digest.perecederos.total;
      const man = digest.manufactura.total;
      return `${digest.sedeName} | P ${formatCount(per.itemCount)} ${formatInventario(per.totalInventario)} | M ${formatCount(man.itemCount)} ${formatInventario(man.totalInventario)}`;
    }),
  ];

  return lines.join("\n");
};
