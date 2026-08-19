"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  onCancel: () => void;
  onConfirm: (signaturePng: string) => void;
  busy?: boolean;
  error?: string | null;
};

export function ChecklistSignaturePad({
  onCancel,
  onConfirm,
  busy = false,
  error,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [inked, setInked] = useState(false);

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(320, Math.round(rect.width * ratio));
    canvas.height = Math.max(140, Math.round(rect.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setInked(false);
  }, []);

  useEffect(() => {
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);
    return () => window.removeEventListener("resize", sizeCanvas);
  }, [sizeCanvas]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    setInked(true);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = false;
    try {
      canvasRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // capture already released
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
        <h2 className="text-base font-semibold text-slate-900">Firma para finalizar</h2>
        <p className="mt-1 text-sm text-slate-600">
          Firma con el mouse o el dedo. Sin firma no se guarda el checklist.
        </p>
        <canvas
          ref={canvasRef}
          className="mt-3 h-52 w-full touch-none rounded-xl border border-slate-300 bg-white sm:h-40"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
        <div className="mt-3 flex flex-col-reverse gap-2 pb-[env(safe-area-inset-bottom)] sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={sizeCanvas}
            className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            Borrar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !inked}
            onClick={() => {
              const data = canvasRef.current?.toDataURL("image/png") ?? "";
              onConfirm(data);
            }}
            className="min-h-12 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-60 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            Firmar y guardar
          </button>
        </div>
      </div>
    </div>
  );
}
