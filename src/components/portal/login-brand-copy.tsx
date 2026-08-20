"use client";

import { useEffect, useState } from "react";
import { PORTAL_APP_VERSION } from "@/lib/shared/uaid-brand";

const enter =
  "transition-[opacity,transform,filter,letter-spacing] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]";

/**
 * Copy del login: entra en cascada al montar (no depende de CSS animation
 * que a veces ya corrió antes de ver la página).
 */
export function LoginBrandCopy() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.setTimeout(() => setVisible(true), 280);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <div className="pointer-events-none relative z-10 max-w-lg">
        <p
          className={`text-sm font-semibold uppercase tracking-[0.32em] text-blue-300 ${enter}`}
          style={{
            transitionDelay: "0ms",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(18px)",
            filter: visible ? "blur(0)" : "blur(8px)",
          }}
        >
          Portal corporativo
        </p>
        <h1
          className={`mt-3 text-6xl font-black uppercase text-white sm:text-7xl lg:text-8xl [text-shadow:0_8px_40px_rgba(0,0,0,0.45)] ${enter}`}
          style={{
            transitionDelay: "220ms",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(36px)",
            filter: visible ? "blur(0)" : "blur(12px)",
            letterSpacing: visible ? "-0.025em" : "0.28em",
          }}
        >
          UAID
        </h1>
        <p
          className={`mt-4 max-w-md text-lg font-medium text-blue-100/90 ${enter}`}
          style={{
            transitionDelay: "480ms",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(22px)",
            filter: visible ? "blur(0)" : "blur(8px)",
          }}
        >
          Unidad de Analítica e Inteligencia de Datos
        </p>
      </div>

      <div
        className={`pointer-events-none absolute right-8 bottom-8 left-8 z-10 flex items-center justify-between text-xs text-blue-200/60 lg:right-16 lg:bottom-12 lg:left-16 ${enter}`}
        style={{
          transitionDelay: "720ms",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(12px)",
        }}
      >
        <p>© 2026 Mercamio · Todos los derechos reservados</p>
        <p className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[10px]">
          {PORTAL_APP_VERSION}
        </p>
      </div>
    </>
  );
}
