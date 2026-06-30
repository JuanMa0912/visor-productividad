import {
  CERO_ROTACION_ESTADO_LABELS,
  type RotacionCriticalDigest,
  type RotacionCriticalDigestSection,
} from "@/lib/rotacion/critical-digest";
import {
  formatPriceWithoutSixZeros,
  formatRangeLabel,
  formatRotationOneDecimal,
  LINEA_N1_FAMILY_LABELS,
  NO_SALES_DI_VALUE,
} from "@/app/rotacion/rotacion-preamble";

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

const renderEstadoBlock = (
  title: string,
  accent: string,
  breakdown: RotacionCriticalDigestSection["ceroRotacion"],
) => `
  <tr>
    <td colspan="2" style="padding:16px 0 8px;font-size:13px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:0.08em;">
      ${title}
    </td>
  </tr>
  <tr>
    <td style="padding:6px 0;color:#475569;">Ítems</td>
    <td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${formatCount(breakdown.itemCount)}</td>
  </tr>
  <tr>
    <td style="padding:6px 0;color:#475569;">${CERO_ROTACION_ESTADO_LABELS.sin_verificar}</td>
    <td style="padding:6px 0;text-align:right;font-weight:600;color:#0f172a;">${formatCount(breakdown.sinVerificar)}</td>
  </tr>
  <tr>
    <td style="padding:6px 0;color:#475569;">${CERO_ROTACION_ESTADO_LABELS.seguimiento}</td>
    <td style="padding:6px 0;text-align:right;font-weight:600;color:#0f172a;">${formatCount(breakdown.seguimiento)}</td>
  </tr>
  <tr>
    <td style="padding:6px 0;color:#475569;">${CERO_ROTACION_ESTADO_LABELS.surtido}</td>
    <td style="padding:6px 0;text-align:right;font-weight:600;color:#0f172a;">${formatCount(breakdown.surtido)} (${formatPctOneDecimal(breakdown.surtidoPct)})</td>
  </tr>
`;

const renderSectionBlock = (
  familyLabel: string,
  accent: string,
  section: RotacionCriticalDigestSection,
) => `
  <tr>
    <td colspan="2" style="padding:20px 0 10px;border-top:1px solid #e2e8f0;">
      <div style="font-size:15px;font-weight:800;color:${accent};letter-spacing:0.04em;">
        ${familyLabel}
      </div>
      <div style="margin-top:6px;font-size:12px;color:#64748b;">
        ${formatCount(section.total.itemCount)} productos · inventario ${formatPriceWithoutSixZeros(section.total.totalInventario)}
      </div>
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding:8px 14px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;">D+0+S · ${familyLabel}</div>
      <div style="margin-top:8px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-size:12px;color:#64748b;">Productos para revisar</div>
          <div style="font-size:20px;font-weight:800;color:#0f172a;">${formatCount(section.total.itemCount)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px;color:#64748b;">Total inventario</div>
          <div style="font-size:20px;font-weight:800;color:#0f172a;">${formatPriceWithoutSixZeros(section.total.totalInventario)}</div>
        </div>
      </div>
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding:16px 0 8px;font-size:13px;font-weight:700;color:#be123c;text-transform:uppercase;letter-spacing:0.08em;">
      D · Demanda
    </td>
  </tr>
  <tr>
    <td style="padding:6px 0;color:#475569;">Ítems categoría D</td>
    <td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${formatCount(section.demandaD.itemCount)}</td>
  </tr>
  <tr>
    <td style="padding:6px 0;color:#475569;">Total inventario</td>
    <td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${formatPriceWithoutSixZeros(section.demandaD.totalInventario)}</td>
  </tr>
  <tr>
    <td style="padding:6px 0;color:#475569;">Días de inventario</td>
    <td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${formatDiasInventario(section.demandaD.diasInventario)}</td>
  </tr>
  ${renderEstadoBlock("0 · Cero rotación", "#475569", section.ceroRotacion)}
  ${renderEstadoBlock("S · Restock / en stock", "#0e7490", section.restockS)}
`;

const renderSectionText = (familyLabel: string, section: RotacionCriticalDigestSection) => {
  const estadoLines = (label: string, b: RotacionCriticalDigestSection["ceroRotacion"]) =>
    [
      `${label}: ${formatCount(b.itemCount)} ítems`,
      `  ${CERO_ROTACION_ESTADO_LABELS.sin_verificar}: ${formatCount(b.sinVerificar)}`,
      `  ${CERO_ROTACION_ESTADO_LABELS.seguimiento}: ${formatCount(b.seguimiento)}`,
      `  ${CERO_ROTACION_ESTADO_LABELS.surtido}: ${formatCount(b.surtido)} (${formatPctOneDecimal(b.surtidoPct)})`,
    ].join("\n");

  return [
    `=== ${familyLabel.toUpperCase()} ===`,
    `TOTAL D+0+S`,
    `  Productos: ${formatCount(section.total.itemCount)}`,
    `  Total inventario: ${formatPriceWithoutSixZeros(section.total.totalInventario)}`,
    "",
    `D · DEMANDA`,
    `  Ítems: ${formatCount(section.demandaD.itemCount)}`,
    `  Total inventario: ${formatPriceWithoutSixZeros(section.demandaD.totalInventario)}`,
    `  Días de inventario: ${formatDiasInventario(section.demandaD.diasInventario)}`,
    "",
    estadoLines("0 · CERO ROTACIÓN", section.ceroRotacion),
    "",
    estadoLines("S · RESTOCK", section.restockS),
  ].join("\n");
};

export const buildRotacionCriticalDigestSubject = (
  digest: RotacionCriticalDigest,
) =>
  `Rotación · ${digest.sedeName} · Críticos D+0+S · ${formatRangeLabel(digest.dateRange)}`;

export const buildRotacionCriticalDigestHtml = (
  digest: RotacionCriticalDigest,
) => {
  const rangeLabel = formatRangeLabel(digest.dateRange);
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rotación · ${digest.sedeName}</title>
</head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
    <tr>
      <td style="padding:24px 24px 12px;background:linear-gradient(180deg,#fff1f2 0%,#ffffff 100%);">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#be123c;">Críticos · Requieren acción</p>
        <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;color:#0f172a;">${digest.sedeName}</h1>
        <p style="margin:0;font-size:14px;color:#64748b;">Periodo consultado: <strong style="color:#334155;">${rangeLabel}</strong> (${digest.daysConsulted} días)</p>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 24px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
          <tr>
            <td colspan="2" style="padding:12px 14px;border-radius:12px;background:#fff1f2;border:1px solid #fecdd3;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#be123c;">Total sede D+0+S</div>
              <div style="margin-top:8px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                <div>
                  <div style="font-size:12px;color:#9f1239;">Productos para revisar</div>
                  <div style="font-size:22px;font-weight:800;color:#881337;">${formatCount(digest.total.itemCount)}</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:12px;color:#9f1239;">Total inventario</div>
                  <div style="font-size:22px;font-weight:800;color:#881337;">${formatPriceWithoutSixZeros(digest.total.totalInventario)}</div>
                </div>
              </div>
            </td>
          </tr>
          ${renderSectionBlock(LINEA_N1_FAMILY_LABELS.perecederos, "#047857", digest.perecederos)}
          ${renderSectionBlock(LINEA_N1_FAMILY_LABELS.manufactura, "#1d4ed8", digest.manufactura)}
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 24px 24px;border-top:1px solid #f1f5f9;font-size:12px;line-height:1.5;color:#94a3b8;">
        Resumen automático del visor de productividad. Perecederos: líneas 01, 02, 03, 04 y 12. Manufactura: resto de líneas N1. Los porcentajes de surtido corresponden al estado S.inventario registrado en rotación.
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

  return [
    `Rotación · ${digest.sedeName}`,
    `Periodo: ${rangeLabel} (${digest.daysConsulted} días)`,
    "",
    `TOTAL SEDE D+0+S`,
    `  Productos: ${formatCount(digest.total.itemCount)}`,
    `  Total inventario: ${formatPriceWithoutSixZeros(digest.total.totalInventario)}`,
    "",
    renderSectionText(LINEA_N1_FAMILY_LABELS.perecederos, digest.perecederos),
    "",
    renderSectionText(LINEA_N1_FAMILY_LABELS.manufactura, digest.manufactura),
  ].join("\n");
};
