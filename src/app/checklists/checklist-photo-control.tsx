"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";

const MAX_EDGE_PX = 1280;
const JPEG_QUALITY = 0.72;

const compressImageFileToJpegBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(
        1,
        MAX_EDGE_PX / Math.max(image.naturalWidth, image.naturalHeight, 1),
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
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const comma = dataUrl.indexOf(",");
      resolve(comma === -1 ? dataUrl : dataUrl.slice(comma + 1));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No se pudo leer la foto."));
    };
    image.src = objectUrl;
  });

type Props = {
  hasPhoto: boolean;
  previewUrl?: string | null;
  disabled?: boolean;
  onUpload: (file: File) => Promise<void>;
};

export function ChecklistPhotoControl({
  hasPhoto,
  previewUrl,
  disabled = false,
  onUpload,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          setError(null);
          void (async () => {
            try {
              await onUpload(file);
            } catch (err) {
              setError(err instanceof Error ? err.message : "No se pudo subir la foto.");
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 disabled:opacity-60 sm:w-auto"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Camera className="h-4 w-4" />
        )}
        {hasPhoto ? "Cambiar foto" : "Subir foto obligatoria"}
      </button>
      {hasPhoto ? (
        <span className="text-xs font-semibold text-emerald-700">Foto lista</span>
      ) : (
        <span className="text-xs font-semibold text-rose-700">
          P y NC requieren foto
        </span>
      )}
      {previewUrl ? (
        <img
          src={previewUrl}
          alt="Evidencia"
          className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200"
        />
      ) : null}
      {error ? <span className="text-xs text-rose-700">{error}</span> : null}
    </div>
  );
}

export { compressImageFileToJpegBase64 };
