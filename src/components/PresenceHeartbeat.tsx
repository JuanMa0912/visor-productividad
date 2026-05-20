"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const HEARTBEAT_INTERVAL_MS = 60_000;
const ACTIVITY_WINDOW_MS = 60_000;

/**
 * Envia un ping a /api/auth/heartbeat para alimentar el panel de presencia.
 * - Cada 60 s mientras la pestana este visible y el usuario haya interactuado
 *   en el ultimo minuto (mouse / teclado / scroll / focus / touch).
 * - Forzado tambien al cambiar de ruta (asi `last_path` queda al dia aunque el
 *   usuario lleve un rato sin tocar nada) y al regresar la pestana al frente.
 */
export default function PresenceHeartbeat() {
  const pathname = usePathname();
  const lastActivityRef = useRef<number>(
    typeof window === "undefined" ? 0 : Date.now(),
  );
  const inFlightRef = useRef(false);
  const cancelledRef = useRef(false);

  const sendHeartbeat = useCallback(async (force = false) => {
    if (cancelledRef.current || inFlightRef.current) return;
    if (typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    if (
      !force &&
      Date.now() - lastActivityRef.current > ACTIVITY_WINDOW_MS
    ) {
      return;
    }
    inFlightRef.current = true;
    try {
      const path =
        typeof window !== "undefined" ? window.location.pathname : "/";
      await fetch("/api/auth/heartbeat", {
        method: "POST",
        credentials: "include",
        headers: {
          "x-presence-heartbeat": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path }),
        cache: "no-store",
        keepalive: true,
      });
    } catch {
      // los heartbeats son best-effort; si falla la red se reintenta en el siguiente tick
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    cancelledRef.current = false;

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
      "pointerdown",
      "focus",
    ];
    activityEvents.forEach((event) =>
      window.addEventListener(event, markActive, {
        passive: true,
      } as AddEventListenerOptions),
    );

    const intervalId = window.setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        lastActivityRef.current = Date.now();
        void sendHeartbeat(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelledRef.current = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      activityEvents.forEach((event) =>
        window.removeEventListener(event, markActive),
      );
    };
  }, [sendHeartbeat]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    lastActivityRef.current = Date.now();
    void sendHeartbeat(true);
  }, [pathname, sendHeartbeat]);

  return null;
}
