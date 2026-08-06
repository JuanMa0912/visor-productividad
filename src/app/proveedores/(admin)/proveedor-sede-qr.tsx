"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Download } from "lucide-react";

type Props = {
  sedeName: string;
  url: string;
  path: string;
  activo: boolean;
};

function slugSede(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function ProveedorSedeQr({ sedeName, url, path, activo }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 240,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((png) => {
        if (!cancelled) {
          setDataUrl(png);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDataUrl(null);
          setError("No se pudo generar el QR.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const download = () => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `proveedores-qr-${slugSede(sedeName)}.png`;
    a.click();
  };

  return (
    <li className="flex flex-col gap-3 border-t border-slate-100 pt-3 first:border-0 first:pt-0 sm:flex-row sm:items-start">
      <div className="shrink-0 rounded-lg border border-slate-200 bg-white p-2">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL local
          <img
            src={dataUrl}
            alt={`QR ingreso proveedores ${sedeName}`}
            width={160}
            height={160}
            className="h-40 w-40"
          />
        ) : (
          <div className="flex h-40 w-40 items-center justify-center text-[11px] text-slate-400">
            {error ?? "Generando…"}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-800">{sedeName}</span>
          {!activo ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
              Inactivo
            </span>
          ) : null}
        </div>
        <a
          href={path}
          target="_blank"
          rel="noreferrer"
          className="block break-all font-mono text-[11px] text-blue-700 underline-offset-2 hover:underline"
        >
          {url}
        </a>
        <button
          type="button"
          onClick={download}
          disabled={!dataUrl}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Descargar PNG
        </button>
      </div>
    </li>
  );
}
