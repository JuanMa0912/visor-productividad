"use client";

import { useRef, useState } from "react";
import { Camera, ImageIcon, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCookieValue, type RotationRow } from "./rotacion-preamble";
import {
  RESTOCK_SURTIDO_FOTO_JPEG_QUALITY,
  RESTOCK_SURTIDO_FOTO_MAX_EDGE_PX,
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
  const [preview, setPreview] = useState<{
    src: string;
    open: boolean;
  } | null>(null);

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

  const openPreview = async () => {
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
        foto?: { fotoBase64: string; mime: string } | null;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "No se pudo cargar la foto.");
      if (!payload.foto) {
        onHasPhotoChange(false);
        onError("Esta fila aun no tiene foto.");
        return;
      }
      setPreview({
        open: true,
        src: restockSurtidoFotoDataUrl(
          payload.foto.fotoBase64,
          payload.foto.mime,
        ),
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Error cargando la foto.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
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
      {canCapture ? (
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
      ) : null}
      {hasPhoto ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          className="h-7 gap-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-teal-800"
          onClick={() => void openPreview()}
        >
          <ImageIcon className="h-3 w-3" />
          Ver foto
        </Button>
      ) : null}
      {preview?.open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa de la foto de surtido"
          onClick={() => setPreview(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-slate-700 shadow"
              onClick={() => setPreview(null)}
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.src}
              alt={`Surtido ${row.item}`}
              className="max-h-[85vh] w-full object-contain"
            />
            <p className="px-3 py-2 text-xs text-slate-600">
              {row.item} · {row.descripcion}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
