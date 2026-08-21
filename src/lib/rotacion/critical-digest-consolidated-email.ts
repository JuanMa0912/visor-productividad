import type {
  RotacionCriticalDigest,
  SurtidoEstadoBreakdown,
} from "@/lib/rotacion/critical-digest";
import {
  formatPrice,
  formatRangeLabel,
  LINEA_N1_FAMILY_LABELS,
  NO_SALES_DI_VALUE,
} from "@/app/rotacion/rotacion-preamble";

/** Monto completo en pesos (igual que el correo individual). */
const formatInventario = (value: number) => formatPrice(value);

const formatCount = (value: number) =>
  value.toLocaleString("es-CO", { maximumFractionDigits: 0 });

const formatPct = (value: number | null) => {
  if (value == null) return "—";
  return `${(Math.round(value * 10) / 10).toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Criticos D+0+S solo Manufactura (misma regla que el correo individual). */
export const sedeCriticalBreakdown = (digest: RotacionCriticalDigest) => {
  const section = digest.manufactura;
  const ceroEstado: SurtidoEstadoBreakdown = section.ceroRotacion;
  const restockEstado: SurtidoEstadoBreakdown = section.restockS;
  return {
    demandaD: section.demandaD.itemCount,
    demandaInventario: section.demandaD.totalInventario,
    cero: ceroEstado.itemCount,
    ceroInventario: ceroEstado.totalInventario ?? 0,
    restockS: restockEstado.itemCount,
    restockInventario: restockEstado.totalInventario ?? 0,
    ceroEstado,
    restockEstado,
    itemCount: section.total.itemCount,
    totalInventario: section.total.totalInventario,
  };
};

/** DI Demanda D de Manufactura (misma métrica del correo individual). */
export const sedeDemandaDiasInventario = (
  digest: RotacionCriticalDigest,
): number | null => {
  const part = digest.manufactura.demandaD;
  if (part.itemCount <= 0) return null;
  return part.diasInventario;
};

export type SedeManagementSignals = {
  sinVerificarCero: number;
  surtidoPctCero: number | null;
  surtidoPctRestock: number | null;
  /** % surtido 0 y S ponderado por inventario (COP) de cada cubo. */
  surtidoPctPonderado: number | null;
  diasInventarioD: number | null;
  /** Frases cortas de foco para el gerente (máx. 2). */
  focusHints: string[];
};

/**
 * % surtido 0 y S ponderado por inventario de cada cubo:
 * (%0 × $0 + %S × $S) / ($0 + $S).
 * No es el promedio simple (a+b)/2 ni el mix por cantidad de ítems.
 */
export const weightedSurtidoPct = (
  cero: Pick<SurtidoEstadoBreakdown, "itemCount" | "surtido" | "totalInventario">,
  restock: Pick<
    SurtidoEstadoBreakdown,
    "itemCount" | "surtido" | "totalInventario"
  >,
): number | null => {
  const pctOf = (part: { itemCount: number; surtido: number }) =>
    part.itemCount > 0 ? (part.surtido / part.itemCount) * 100 : null;

  const parts: Array<{ pct: number; weight: number }> = [];
  const pctCero = pctOf(cero);
  const pctRestock = pctOf(restock);
  const weightCero = Math.max(0, cero.totalInventario ?? 0);
  const weightRestock = Math.max(0, restock.totalInventario ?? 0);
  if (pctCero != null && weightCero > 0) {
    parts.push({ pct: pctCero, weight: weightCero });
  }
  if (pctRestock != null && weightRestock > 0) {
    parts.push({ pct: pctRestock, weight: weightRestock });
  }
  const weight = parts.reduce((sum, part) => sum + part.weight, 0);
  if (weight <= 0) return null;
  return parts.reduce((sum, part) => sum + part.pct * part.weight, 0) / weight;
};

/** Señales para saber si la sede “funciona” y qué mejorar. */
export const buildSedeManagementSignals = (
  digest: RotacionCriticalDigest,
): SedeManagementSignals => {
  const breakdown = sedeCriticalBreakdown(digest);
  const diasInventarioD = sedeDemandaDiasInventario(digest);
  const hints: string[] = [];
  const score = digest.restockEffectiveness.score;
  const hasRestockMarks =
    !digest.restockEffectiveness.unavailable &&
    digest.restockEffectiveness.markedSurtidoCount > 0;

  if (hasRestockMarks && score != null && score < 40) {
    hints.push("Restock bajo: revisar que lo marcado surtido sí venda");
  } else if (
    breakdown.restockS > 0 &&
    (breakdown.restockEstado.surtidoPct == null ||
      breakdown.restockEstado.surtidoPct < 30)
  ) {
    hints.push("Restock S poco avanzado a surtido");
  }

  if (
    breakdown.cero > 0 &&
    breakdown.ceroEstado.sinVerificar / breakdown.cero >= 0.45
  ) {
    hints.push("Muchos ceros sin verificar");
  } else if (
    breakdown.cero > 0 &&
    (breakdown.ceroEstado.surtidoPct == null ||
      breakdown.ceroEstado.surtidoPct < 25)
  ) {
    hints.push("Ceros con poco % surtido");
  }

  if (
    diasInventarioD != null &&
    (diasInventarioD >= NO_SALES_DI_VALUE || diasInventarioD >= 45)
  ) {
    hints.push(
      diasInventarioD >= NO_SALES_DI_VALUE
        ? "Demanda D sin venta: priorizar salida"
        : "DI alto en Demanda D: acelerar rotación",
    );
  }

  if (hints.length === 0) {
    hints.push("Sin alertas fuertes · mantener ritmo");
  }

  return {
    sinVerificarCero: breakdown.ceroEstado.sinVerificar,
    surtidoPctCero: breakdown.ceroEstado.surtidoPct,
    surtidoPctRestock: breakdown.restockEstado.surtidoPct,
    surtidoPctPonderado: weightedSurtidoPct(
      breakdown.ceroEstado,
      breakdown.restockEstado,
    ),
    diasInventarioD,
    focusHints: hints.slice(0, 2),
  };
};

export type ConsolidatedDigestTotals = {
  itemCount: number;
  totalInventario: number;
  demandaD: number;
  cero: number;
  restockS: number;
  restockScore: number;
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
    const breakdown = sedeCriticalBreakdown(digest);
    itemCount += breakdown.itemCount;
    totalInventario += breakdown.totalInventario;
    demandaD += breakdown.demandaD;
    cero += breakdown.cero;
    restockS += breakdown.restockS;
    const eff = digest.restockEffectiveness;
    if (eff.unavailable) continue;
    restockMarked += eff.markedSurtidoCount;
    restockSold += eff.soldAfterCount;
  }

  const restockScore =
    restockMarked > 0 ? Math.round((restockSold / restockMarked) * 100) : 0;

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
  accent = "#1d4ed8",
  border = "#bfdbfe",
) =>
  `<th style="padding:7px 6px;border-bottom:2px solid ${border};font-size:9px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${accent};text-align:${align};white-space:nowrap;">${label}</th>`;

const td = (
  content: string,
  align: "left" | "right" | "center" = "left",
  extra = "",
) =>
  `<td style="padding:8px 6px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#0f172a;text-align:${align};vertical-align:middle;${extra}">${content}</td>`;

const buildOverviewRows = (digests: readonly RotacionCriticalDigest[]) =>
  digests
    .map((digest, index) => {
      const bg = index % 2 === 0 ? "#ffffff" : "#eff6ff";
      const breakdown = sedeCriticalBreakdown(digest);
      return `<tr style="background:${bg};">
        ${td(`<strong>${escapeHtml(digest.sedeName)}</strong>`)}
        ${td(
          formatInventario(breakdown.totalInventario),
          "right",
          "font-size:15px;font-weight:800;color:#1d4ed8;font-variant-numeric:tabular-nums;",
        )}
        ${td(
          `${formatCount(breakdown.demandaD)}<div style="font-size:10px;color:#9f1239;">${formatInventario(breakdown.demandaInventario)}</div>`,
          "right",
          "font-variant-numeric:tabular-nums;color:#9f1239;",
        )}
        ${td(
          `${formatCount(breakdown.cero)}<div style="font-size:10px;color:#64748b;">${formatInventario(breakdown.ceroInventario)}</div>`,
          "right",
          "font-variant-numeric:tabular-nums;color:#475569;",
        )}
        ${td(
          `${formatCount(breakdown.restockS)}<div style="font-size:10px;color:#0e7490;">${formatInventario(breakdown.restockInventario)}</div>`,
          "right",
          "font-variant-numeric:tabular-nums;color:#0e7490;",
        )}
      </tr>`;
    })
    .join("");

const buildManagementRows = (digests: readonly RotacionCriticalDigest[]) =>
  digests
    .map((digest, index) => {
      const bg = index % 2 === 0 ? "#ffffff" : "#f8fafc";
      const signals = buildSedeManagementSignals(digest);
      const focusHtml = signals.focusHints
        .map((hint) => escapeHtml(hint))
        .join("<br/>");
      return `<tr style="background:${bg};">
        ${td(`<strong>${escapeHtml(digest.sedeName)}</strong>`)}
        ${td(formatCount(signals.sinVerificarCero), "right", "font-variant-numeric:tabular-nums;")}
        ${td(formatPct(signals.surtidoPctCero), "right", "font-variant-numeric:tabular-nums;")}
        ${td(formatPct(signals.surtidoPctRestock), "right", "font-variant-numeric:tabular-nums;color:#0e7490;")}
        ${td(formatPct(signals.surtidoPctPonderado), "right", "font-variant-numeric:tabular-nums;font-weight:700;")}
        ${td(`<span style="font-size:11px;line-height:1.35;color:#334155;">${focusHtml}</span>`, "left")}
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
  return `Rotación · Todas las sedes · Manufactura D+0+S · ${rangeLabel}`;
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
  const scoreLabel = `${totals.restockScore ?? 0}`;
  const scoreDetail = `${formatCount(totals.restockSold)} de ${formatCount(totals.restockMarked)} vendieron tras surtido`;
  const familyLabel = LINEA_N1_FAMILY_LABELS.manufactura;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rotación · Todas las sedes · ${familyLabel}</title>
</head>
<body style="margin:0;padding:12px;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:820px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <tr>
      <td style="padding:14px 16px 10px;background:#eff6ff;border-bottom:1px solid #bfdbfe;">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#1d4ed8;">Críticos · ${familyLabel} · D+0+S · Cadena</div>
        <div style="margin-top:2px;font-size:20px;font-weight:800;line-height:1.2;color:#0f172a;">Todas las sedes</div>
        <div style="margin-top:2px;font-size:12px;color:#64748b;">${escapeHtml(rangeLabel)} · ${formatCount(days)} días · ${formatCount(digests.length)} sedes</div>
      </td>
    </tr>

    <tr>
      <td style="padding:10px 16px 4px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
          <tr>
            <td style="padding:10px 12px;font-size:12px;line-height:1.45;color:#334155;">
              <strong style="color:#0f172a;">Cómo leer (gerente)</strong><br/>
              <span style="color:#64748b;">· Solo <strong>${familyLabel}</strong> (líneas N1 distintas de 01–04 y 12).</span><br/>
              <span style="color:#64748b;">· <strong>Restock alto</strong> = lo marcado surtido sí está vendiendo.</span><br/>
              <span style="color:#64748b;">· <strong>Inventario / D·0·S</strong> = tamaño del problema crítico en la sede.</span><br/>
              <span style="color:#64748b;">· <strong>Gestión</strong> = qué falta por hacer (sin verificar, % surtido 0/S y ponderado).</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:10px 16px 6px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">
          <tr>
            <td style="padding:10px 12px;">
              <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#1d4ed8;">Total cadena · ${familyLabel} D+0+S</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:6px;">
                <tr>
                  <td style="vertical-align:top;">
                    <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Productos</div>
                    <div style="margin-top:2px;font-size:18px;font-weight:800;color:#0f172a;">${formatCount(totals.itemCount)}</div>
                  </td>
                  <td style="vertical-align:top;text-align:right;">
                    <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Inventario</div>
                    <div style="margin-top:2px;font-size:22px;font-weight:800;color:#1d4ed8;">${formatInventario(totals.totalInventario)}</div>
                  </td>
                </tr>
              </table>
              <div style="margin-top:8px;padding-top:8px;border-top:1px solid #bfdbfe;font-size:12px;color:#475569;">
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
        <div style="font-size:11px;font-weight:800;color:#0f172a;margin-bottom:4px;">1 · Comparativo (tamaño del crítico)</div>
        <div style="font-size:11px;color:#64748b;margin-bottom:8px;">Mismas cifras del correo individual por sede (${familyLabel}).</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #bfdbfe;border-radius:10px;overflow:hidden;">
          <thead>
            <tr style="background:#eff6ff;">
              ${th("Sede")}
              ${th("Inventario", "right")}
              ${th("D", "right")}
              ${th("0", "right")}
              ${th("S", "right")}
            </tr>
          </thead>
          <tbody>
            ${buildOverviewRows(digests)}
            <tr style="background:#dbeafe;">
              ${td("<strong>Total</strong>")}
              ${td(
                `<strong>${formatInventario(totals.totalInventario)}</strong>`,
                "right",
                "font-size:15px;font-weight:800;color:#1d4ed8;",
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
      <td style="padding:14px 16px 4px;">
        <div style="font-size:11px;font-weight:800;color:#0f172a;margin-bottom:4px;">2 · Gestión (qué mejorar)</div>
        <div style="font-size:11px;color:#64748b;margin-bottom:8px;">
          Sin ver = ceros aún sin revisar. % surtido 0/S = avance del admin. % pond. = (% 0 × inventario 0 + % S × inventario S) ÷ inventario 0+S.
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
          <thead>
            <tr style="background:#ecfeff;">
              ${th("Sede", "left", "#0e7490", "#a5f3fc")}
              ${th("Sin ver", "right", "#0e7490", "#a5f3fc")}
              ${th("% surt. 0", "right", "#0e7490", "#a5f3fc")}
              ${th("% surt. S", "right", "#0e7490", "#a5f3fc")}
              ${th("% pond.", "right", "#0e7490", "#a5f3fc")}
              ${th("Foco", "left", "#0e7490", "#a5f3fc")}
            </tr>
          </thead>
          <tbody>
            ${buildManagementRows(digests)}
          </tbody>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:10px 16px 14px;border-top:1px solid #f1f5f9;font-size:10px;line-height:1.45;color:#94a3b8;">
        Automático · Visor. Solo ${familyLabel} (mismas reglas D+0+S que el correo de cada sede).
        Foco = alertas automáticas (restock &lt; 40, ceros sin verificar, poco % surtido, DI D alto).
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
  const scoreLabel = String(totals.restockScore ?? 0);
  const familyLabel = LINEA_N1_FAMILY_LABELS.manufactura;

  const lines = [
    `Rotación · Todas las sedes · ${familyLabel} D+0+S`,
    `Periodo: ${rangeLabel} (${formatCount(days)} días) · ${formatCount(digests.length)} sedes`,
    "",
    `TOTAL CADENA ${familyLabel.toUpperCase()}: ${formatCount(totals.itemCount)} productos · ${formatInventario(totals.totalInventario)}`,
    `Restock cadena: ${scoreLabel} (${formatCount(totals.restockSold)} de ${formatCount(totals.restockMarked)})`,
    `D ${formatCount(totals.demandaD)} · 0 ${formatCount(totals.cero)} · S ${formatCount(totals.restockS)}`,
    "",
    "1. COMPARATIVO | INV | D | 0 | S",
    ...digests.map((digest) => {
      const breakdown = sedeCriticalBreakdown(digest);
      return `${digest.sedeName} | ${formatInventario(breakdown.totalInventario)} | ${formatCount(breakdown.demandaD)} | ${formatCount(breakdown.cero)} | ${formatCount(breakdown.restockS)}`;
    }),
    "",
    "2. GESTIÓN | SIN VER | %SURT 0 | %SURT S | %POND | FOCO",
    ...digests.map((digest) => {
      const signals = buildSedeManagementSignals(digest);
      return `${digest.sedeName} | ${formatCount(signals.sinVerificarCero)} | ${formatPct(signals.surtidoPctCero)} | ${formatPct(signals.surtidoPctRestock)} | ${formatPct(signals.surtidoPctPonderado)} | ${signals.focusHints.join("; ")}`;
    }),
  ];

  return lines.join("\n");
};
