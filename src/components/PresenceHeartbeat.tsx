"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import {
  SESSION_IDLE_MS,
  isSessionIdle,
  loginUrlAfterIdle,
} from "@/lib/auth/session-idle";

const HEARTBEAT_INTERVAL_MS = 60_000;
const IDLE_CHECK_INTERVAL_MS = 15_000;
const ACTIVITY_WINDOW_MS = 60_000;

/**
 * Reporta uso real a /api/auth/heartbeat y cierra la sesion a los 60 min
 * sin clic/teclado/scroll/navegacion, para no inflar metricas de uso.
 */
export default function PresenceHeartbeat() {
  const pathname = usePathname();
  const { status, logout } = useAuth();
  const isAuthenticated = status === "authenticated";
  const lastActivityRef = useRef<number>(
    typeof window === "undefined" ? 0 : Date.now(),
  );
  const inFlightRef = useRef(false);
  const cancelledRef = useRef(false);
  const loggingOutRef = useRef(false);

  const endIdleSession = useCallback(() => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    void logout({ redirectTo: loginUrlAfterIdle() });
  }, [logout]);

  const sendHeartbeat = useCallback(
    async (force = false) => {
      if (cancelledRef.current || inFlightRef.current) return;
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      if (isSessionIdle(lastActivityRef.current)) {
        endIdleSession();
        return;
      }
      if (!force && Date.now() - lastActivityRef.current > ACTIVITY_WINDOW_MS) {
        return;
      }
      inFlightRef.current = true;
      try {
        const path =
          typeof window !== "undefined" ? window.location.pathname : "/";
        const response = await fetch("/api/auth/heartbeat", {
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
        if (response.status === 401) {
          endIdleSession();
        }
      } catch {
        // best-effort; el siguiente tick reintenta
      } finally {
        inFlightRef.current = false;
      }
    },
    [endIdleSession],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isAuthenticated) return;
    cancelledRef.current = false;
    loggingOutRef.current = false;

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
    ];
    activityEvents.forEach((event) =>
      window.addEventListener(event, markActive, {
        passive: true,
      } as AddEventListenerOptions),
    );

    const heartbeatId = window.setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    const idleId = window.setInterval(() => {
      if (isSessionIdle(lastActivityRef.current)) {
        endIdleSession();
      }
    }, IDLE_CHECK_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (isSessionIdle(lastActivityRef.current)) {
        endIdleSession();
        return;
      }
      void sendHeartbeat();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelledRef.current = true;
      window.clearInterval(heartbeatId);
      window.clearInterval(idleId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      activityEvents.forEach((event) =>
        window.removeEventListener(event, markActive),
      );
    };
  }, [sendHeartbeat, isAuthenticated, endIdleSession]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isAuthenticated) return;
    lastActivityRef.current = Date.now();
    void sendHeartbeat(true);
  }, [pathname, sendHeartbeat, isAuthenticated]);

  return null;
}
