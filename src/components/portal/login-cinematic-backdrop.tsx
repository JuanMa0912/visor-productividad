"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";

const LoginCinematicScene = dynamic(
  () =>
    import("@/components/portal/login-cinematic-scene").then(
      (mod) => mod.LoginCinematicScene,
    ),
  { ssr: false },
);

function PreloadGlow() {
  return <div className="login-cinematic-preload absolute inset-0" aria-hidden />;
}

/** Escena 3D del login: red neuronal / flujo de datos, con fade de entrada. */
export function LoginCinematicBackdrop() {
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 1200);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#03060d]">
      <div className="absolute inset-0">
        <LoginCinematicScene onReady={markReady} />
      </div>
      <div
        className={`pointer-events-none absolute inset-0 transition-opacity duration-[900ms] ease-out ${
          ready ? "opacity-0" : "opacity-100"
        }`}
      >
        <PreloadGlow />
      </div>
      <div
        aria-hidden
        className="login-cinematic-grain pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay"
      />
    </div>
  );
}
