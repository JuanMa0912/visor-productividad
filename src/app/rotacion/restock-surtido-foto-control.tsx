"use client";

import { useRef, useState } from "react";
import { Camera, ClipboardCheck, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCookieValue, type RotationRow } from "./rotacion-preamble";
import {
  RESTOCK_SURTIDO_FOTO_JPEG_QUALITY,
  RESTOCK_SURTIDO_FOTO_MAX_EDGE_PX,
  formatRestockSurtidoWhen,
  restockSurtidoFotoDataUrl,
} from "@/lib/rotacion/restock-surtido-foto";
import type { CeroRotacionEstado } from "@/lib/rotacion/cero-estado";

const compressImageFileToJpegBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(
        1,
        RESTOCK_SURTIDO_FOTO_MAX_EDGE_PX /
          Math.max(image.naturalWidth, image.naturalHeight, 1),
      );
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("No se pudo procesar la foto."));
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      const dataUrl = canvas.toDataURL(
        "image/jpeg",
        RESTOCK_SURTIDO_FOTO_JPEG_QUALITY,
      );
      const comma = dataUrl.indexOf(",");
      resolve(comma === -1 ? dataUrl : dataUrl.slice(comma + 1));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No se pudo leer la foto."));
    };
    image.src = objectUrl;
  });

type RestockSurtidoFotoControlProps = {
  row: RotationRow;
  estado: CeroRotacionEstado;
  dateStart: string;
  dateEnd: string;
  hasPhoto: boolean;
  onHasPhotoChange: (hasPhoto: boolean) => void;
  onError: (message: string) => void;
};

type RestockSurtidoAuditButtonProps = {
  row: RotationRow;
  dateStart: string;
  dateEnd: string;
  hasPhoto: boolean;
  onHasPhotoChange: (hasPhoto: boolean) => void;
  onError: (message: string) => void;
};

type RestockAuditPreview = {
  src: string;
  fotoUpdatedAt: string | null;
  surtidoAt: string | null;
  surtidoUsername: string | null;
};

export function RestockSurtidoFotoControl({
  row,
  estado,
  dateStart,
  dateEnd,
  hasPhoto,
  onHasPhotoChange,
  onError,
}: RestockSurtidoFotoControlProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const canCapture = estado === "surtido";

  const uploadFoto = async (file: File) => {
    const csrf = getCookieValue("vp_csrf");
    if (!csrf) {
      onError("No se pudo validar la sesion. Recargue la pagina.");
      return;
    }
    setBusy(true);
    try {
      const fotoBase64 = await compressImageFileToJpegBase64(file);
      const res = await fetch("/api/rotacion/restock-fotos", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({
          empresa: row.empresa,
          sedeId: row.sedeId,
          item: row.item,
          start: dateStart,
          end: dateEnd,
          mime: "image/jpeg",
          fotoBase64,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "No se pudo guardar la foto.");
      }
      onHasPhotoChange(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error guardando la foto.");
    } finally {
      setBusy(false);
    }
  };

  if (!canCapture) return null;

  return (
    <div className="mt-1">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadFoto(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        className="h-7 gap-1 rounded-md px-2 text-[10px] font-semibold uppercase tracking-wide"
        onClick={() => fileRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Camera className="h-3 w-3" />
        )}
        {hasPhoto ? "Cambiar foto" : "Tomar foto"}
      </Button>
    </div>
  );
}

export function RestockSurtidoAuditButton({
  row,
  dateStart,
  dateEnd,
  hasPhoto,
  onHasPhotoChange,
  onError,
}: RestockSurtidoAuditButtonProps) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RestockAuditPreview | null>(null);

  const openAudit = async () => {
    if (!hasPhoto) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({
        start: dateStart,
        end: dateEnd,
        empresa: row.empresa,
        sedeId: row.sedeId,
        item: row.item,
      });
      const res = await fetch(`/api/rotacion/restock-fotos?${params}`, {
        cache: "no-store",
      });
      const payload = (await res.json()) as {
        foto?: { fotoBase64: string; mime: string; updatedAt?: string } | null;
        surtido?: { at: string; username: string | null } | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "No se pudo cargar la auditoria.");
      }
      if (!payload.foto) {
        onHasPhotoChange(false);
        onError("Este ítem aún no tiene foto de evidencia.");
        return;
      }
      onHasPhotoChange(true);
      setPreview({
        src: restockSurtidoFotoDataUrl(
          payload.foto.fotoBase64,
          payload.foto.mime,
        ),
        fotoUpdatedAt: payload.foto.updatedAt ?? null,
        surtidoAt: payload.surtido?.at ?? null,
        surtidoUsername: payload.surtido?.username ?? null,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error cargando la auditoria.");
    } finally {
      setBusy(false);
    }
  };

  const surtidoWhen = formatRestockSurtidoWhen(preview?.surtidoAt);
  const fotoWhen = formatRestockSurtidoWhen(preview?.fotoUpdatedAt);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasPhoto || busy}
        title={
          hasPhoto
            ? "Ver foto y cuándo se marcó surtido"
            : "Sin foto de evidencia"
        }
        className={`h-7 gap-1 rounded-md px-2 text-[10px] font-semibold uppercase tracking-wide ${
          hasPhoto
            ? "border-teal-200 bg-teal-50/80 text-teal-900 hover:bg-teal-100"
            : "border-slate-200 bg-slate-100 text-slate-400"
        }`}
        onClick={() => void openAudit()}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <ClipboardCheck className="h-3 w-3" />
        )}
        Auditar
      </Button>
      {preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restock-surtido-audit-title"
          onClick={() => setPreview(null)}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Auditoría de restock
                </p>
                <h2
                  id="restock-surtido-audit-title"
                  className="truncate font-mono text-sm font-semibold text-slate-900"
                >
                  {row.item}
                </h2>
                <p className="truncate text-xs text-slate-500">
                  {row.descripcion}
                </p>
              </div>
              <button
                type="button"
                className="rounded-full bg-white p-1 text-slate-700 shadow-sm ring-1 ring-slate-200"
                onClick={() => setPreview(null)}
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-[180px] items-center justify-center overflow-auto bg-slate-50 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- base64 en memoria, no pasa por el optimizador */}
              <img
                src={preview.src}
                alt={`Evidencia de surtido del ítem ${row.item}`}
                className="max-h-[62vh] w-full rounded-lg object-contain"
              />
            </div>
            <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
              <p>
                Habilitado como surtido:{" "}
                {surtidoWhen ? (
                  <strong className="font-semibold text-slate-900">
                    {surtidoWhen}
                    {preview.surtidoUsername
                      ? ` · ${preview.surtidoUsername}`
                      : ""}
                  </strong>
                ) : (
                  <span className="text-slate-500">aún no se ha marcado</span>
                )}
              </p>
              {fotoWhen ? (
                <p>
                  Foto subida:{" "}
                  <strong className="font-semibold text-slate-900">
                    {fotoWhen}
                  </strong>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
