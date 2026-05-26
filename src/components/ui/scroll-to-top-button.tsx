"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/shared/utils";

export type ScrollToTopButtonProps = {
  /** Umbral en px de scroll vertical antes de mostrar el boton. Default 400. */
  threshold?: number;
  /** Posicion absoluta del boton. Default `bottom-6 right-6`. */
  position?: string;
  /** Indice z. Default 40. */
  zIndex?: number;
  /** Clase extra opcional para sobrescribir estilos especificos. */
  className?: string;
};

/**
 * Boton flotante circular para volver al inicio de la pagina.
 * Aparece con fade-in cuando el usuario ha scroleado mas alla de `threshold`
 * y respeta `prefers-reduced-motion`. Estilo unificado entre todos los modulos.
 */
export function ScrollToTopButton({
  threshold = 400,
  position = "bottom-6 right-6",
  zIndex = 40,
  className,
}: ScrollToTopButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let ticking = false;
    const evaluate = () => {
      setVisible(window.scrollY > threshold);
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(evaluate);
    };
    evaluate();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  const handleClick = useCallback(() => {
    if (typeof window === "undefined") return;
    const prefersReducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, []);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Volver arriba"
      title="Volver arriba"
      className={cn(
        "fixed inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white shadow-[0_18px_40px_-20px_rgba(15,23,42,0.75)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2",
        position,
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0",
        className,
      )}
      style={{ zIndex }}
    >
      <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
    </button>
  );
}
