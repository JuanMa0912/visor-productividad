import {
  type RotacionCriticalDigest,
  type RotacionCriticalDigestSection,
  type SurtidoEstadoBreakdown,
} from "@/lib/rotacion/critical-digest";
import {
  formatPrice,
  formatRangeLabel,
  formatRotationOneDecimal,
  LINEA_N1_FAMILY_LABELS,
  NO_SALES_DI_VALUE,
} from "@/app/rotacion/rotacion-preamble";

/** Monto completo en pesos (con ceros de millones); solo para el correo. */
const formatEmailInventario = (value: number) => formatPrice(value);

const formatCount = (value: number) =>
  value.toLocaleString("es-CO", { maximumFractionDigits: 0 });

const formatPctOneDecimal = (value: number | null) => {
  if (value == null) return "—";
  return `${(Math.round(value * 10) / 10).toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
};

const formatDiasInventario = (value: number) => {
  if (value >= NO_SALES_DI_VALUE) return "Sin venta";
  return formatRotationOneDecimal(value);
};

/** Estados 0/S en una sola línea corta. */
const formatEstadoLine = (b: SurtidoEstadoBreakdown) =>
  `Sin ver ${formatCount(b.sinVerificar)} · Seg ${formatCount(b.seguimiento)} · Surt ${formatCount(b.surtido)} (${formatPctOneDecimal(b.surtidoPct)})`;

const formatScoreLabel = (
  digest: RotacionCriticalDigest,
): { value: string; detail: string } => {
  const eff = digest.restockEffectiveness;
  if (eff.unavailable) {
    return { value: "—", detail: "Sin datos de auditoría/ventas" };
  }
  const score = eff.score ?? 0;
  return {
    value: `${score}`,
    detail: `${formatCount(eff.soldAfterCount)} de ${formatCount(eff.markedSurtidoCount)} vendieron tras surtido`,
  };
};

const tdMetric = (
  label: string,
  value: string,
  align: "left" | "right" | "center" = "left",
  valueStyle?: { color?: string; fontSize?: string },
) =>
  `<td style="padding:4px 6px;vertical-align:top;text-align:${align};">
    <div style="font-size:10px;line-height:1.2;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">${label}</div>
    <div style="margin-top:2px;font-size:${valueStyle?.fontSize ?? "14px"};line-height:1.25;font-weight:800;color:${valueStyle?.color ?? "#0f172a"};">${value}</div>
  </td>`;

const renderEstadoCell = (
  code: string,
  title: string,
  accent: string,
  breakdown: SurtidoEstadoBreakdown,
) => `
  <td width="33%" valign="top" style="padding:6px;border:1px solid #e2e8f0;border-radius:8px;background:#ffffff;">
    <div style="font-size:11px;font-weight:800;color:${accent};">${code} · ${title}</div>
    <div style="margin-top:4px;font-size:18px;font-weight:800;color:#0f172a;line-height:1;">${formatCount(breakdown.itemCount)}</div>
    <div style="margin-top:4px;font-size:11px;line-height:1.35;color:#475569;">${formatEstadoLine(breakdown)}</div>
  </td>
`;

const renderSectionBlock = (
  familyLabel: string,
  accent: string,
  headerBg: string,
  section: RotacionCriticalDigestSection,
) => `
  <tr>
    <td style="padding:10px 0 0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <tr>
          <td style="padding:8px 10px;background:${headerBg};border-bottom:1px solid #e2e8f0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td style="font-size:13px;font-weight:800;color:${accent};">${familyLabel}</td>
                <td style="text-align:right;font-size:12px;color:#475569;">
                  <strong style="color:#0f172a;">${formatCount(section.total.itemCount)}</strong>
                  · ${formatEmailInventario(section.total.totalInventario)}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 8px 4px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:4px;">
              <tr>
                <td width="33%" valign="top" style="padding:6px;border:1px solid #fecdd3;border-radius:8px;background:#fff1f2;">
                  <div style="font-size:11px;font-weight:800;color:#be123c;">D · Demanda</div>
                  <div style="margin-top:4px;font-size:18px;font-weight:800;color:#881337;line-height:1;">${formatCount(section.demandaD.itemCount)}</div>
                  <div style="margin-top:4px;font-size:11px;line-height:1.35;color:#9f1239;">
                    ${formatEmailInventario(section.demandaD.totalInventario)}<br/>
                    Días de inventario ${formatDiasInventario(section.demandaD.diasInventario)}
                  </div>
                </td>
                ${renderEstadoCell("0", "Cero", "#475569", section.ceroRotacion)}
                ${renderEstadoCell("S", "Restock", "#0e7490", section.restockS)}
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
`;

const renderSectionText = (familyLabel: string, section: RotacionCriticalDigestSection) => {
  return [
    `=== ${familyLabel.toUpperCase()} ===`,
    `Total D+0+S: ${formatCount(section.total.itemCount)} · ${formatEmailInventario(section.total.totalInventario)}`,
    `D Demanda: ${formatCount(section.demandaD.itemCount)} · ${formatEmailInventario(section.demandaD.totalInventario)} · Días de inventario ${formatDiasInventario(section.demandaD.diasInventario)}`,
    `0 Cero: ${formatCount(section.ceroRotacion.itemCount)} · ${formatEstadoLine(section.ceroRotacion)}`,
    `S Restock: ${formatCount(section.restockS.itemCount)} · ${formatEstadoLine(section.restockS)}`,
  ].join("\n");
};

export const buildRotacionCriticalDigestSubject = (
  digest: RotacionCriticalDigest,
) =>
  `Rotación · ${digest.sedeName} · Manufactura D+0+S · ${formatRangeLabel(digest.dateRange)}`;

export const buildRotacionCriticalDigestHtml = (
  digest: RotacionCriticalDigest,
) => {
  const rangeLabel = formatRangeLabel(digest.dateRange);
  const score = formatScoreLabel(digest);
  const section = digest.manufactura;
  const familyLabel = LINEA_N1_FAMILY_LABELS.manufactura;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rotación · ${digest.sedeName}</title>
</head>
<body style="margin:0;padding:12px;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <tr>
      <td style="padding:12px 14px 8px;background:#eff6ff;border-bottom:1px solid #bfdbfe;">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#1d4ed8;">Críticos · ${familyLabel} · D+0+S</div>
        <div style="margin-top:2px;font-size:18px;font-weight:800;line-height:1.2;color:#0f172a;">${digest.sedeName}</div>
        <div style="margin-top:2px;font-size:12px;color:#64748b;">${rangeLabel} · ${digest.daysConsulted} días</div>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 14px 4px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ecfeff;border:1px solid #a5f3fc;border-radius:8px;">
          <tr>
            <td style="padding:8px 10px;">
              <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#0e7490;">Puntuación restock (0–100)</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:4px;">
                <tr>
                  <td style="font-size:28px;font-weight:800;line-height:1;color:#155e75;vertical-align:middle;">${score.value}</td>
                  <td style="text-align:right;font-size:11px;line-height:1.35;color:#0f766e;vertical-align:middle;">${score.detail}</td>
                </tr>
              </table>
              <div style="margin-top:6px;font-size:10px;line-height:1.35;color:#64748b;">
                % de ítems restock marcados <strong>surtido</strong> en el periodo que luego tuvieron venta.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 14px 4px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
          <tr>
            <td colspan="3" style="padding:6px 10px 2px;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#1d4ed8;">${familyLabel} · D+0+S</td>
          </tr>
          <tr>
            ${tdMetric("Productos", formatCount(section.total.itemCount))}
            ${tdMetric(
              "Inventario",
              formatEmailInventario(section.total.totalInventario),
              "center",
              { color: "#1d4ed8", fontSize: "18px" },
            )}
            ${tdMetric(
              "Días de inventario",
              formatDiasInventario(section.demandaD.diasInventario),
              "right",
              { color: "#be123c", fontSize: "18px" },
            )}
          </tr>
          <tr>
            <td colspan="3" style="padding:2px 10px 8px;font-size:10px;line-height:1.35;color:#64748b;">
              Días de inventario = cobertura de inventario en ítems Demanda (D).
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 14px 10px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
          ${renderSectionBlock(familyLabel, "#1d4ed8", "#eff6ff", section)}
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 14px 12px;border-top:1px solid #f1f5f9;font-size:10px;line-height:1.4;color:#94a3b8;">
        Automático · Visor. Solo ${familyLabel} (resto de líneas N1; perecederos 01–04 y 12 omitidos por ahora). Puntuación restock: primera marca a surtido en el rango + venta en o después.
      </td>
    </tr>
  </table>
</body>
</html>`;
};

export const buildRotacionCriticalDigestText = (
  digest: RotacionCriticalDigest,
) => {
  const rangeLabel = formatRangeLabel(digest.dateRange);
  const score = formatScoreLabel(digest);
  const section = digest.manufactura;
  const familyLabel = LINEA_N1_FAMILY_LABELS.manufactura;

  return [
    `Rotación · ${digest.sedeName}`,
    `Periodo: ${rangeLabel} (${digest.daysConsulted} días)`,
    "",
    `PUNTUACIÓN RESTOCK: ${score.value}/100`,
    `  ${score.detail}`,
    "",
    `${familyLabel.toUpperCase()} D+0+S: ${formatCount(section.total.itemCount)} · ${formatEmailInventario(section.total.totalInventario)} · Días de inventario ${formatDiasInventario(section.demandaD.diasInventario)}`,
    "",
    renderSectionText(familyLabel, section),
  ].join("\n");
};
