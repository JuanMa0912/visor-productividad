"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import {
  isSessionIdle,
  loginUrlAfterIdle,
  shouldRecordActivity,
} from "@/lib/auth/session-idle";

const HEARTBEAT_INTERVAL_MS = 60_000;
const IDLE_CHECK_INTERVAL_MS = 5_000;
const ACTIVITY_WINDOW_MS = 60_000;

/** Gestos deliberados. `scroll` no cuenta: al volver a la pestaña el browser
 * dispara scroll de restauración y eso reiniciaba el idle de forma intermitente. */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "mousedown",
  "keydown",
  "touchstart",
  "click",
] as const;

/**
 * Reporta uso real a /api/auth/heartbeat y cierra la sesion a los 5 min
 * sin clic/teclado/toque/navegacion, para no inflar metricas de uso.
 */
export default function PresenceHeartbeat() {
  const pathname = usePathname();
  const { status, logout } = useAuth();
  const isAuthenticated = status === "authenticated";
  const lastActivityRef = useRef<number>(Date.now());
  const inFlightRef = useRef(false);
  const cancelledRef = useRef(false);
  const loggingOutRef = useRef(false);
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const endIdleSession = useCallback(() => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    void logoutRef.current({ redirectTo: loginUrlAfterIdle() });
  }, []);

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

  const sendHeartbeatRef = useRef(sendHeartbeat);
  sendHeartbeatRef.current = sendHeartbeat;

  const markActive = useCallback(() => {
    const now = Date.now();
    if (!shouldRecordActivity(lastActivityRef.current, now)) {
      endIdleSession();
      return;
    }
    lastActivityRef.current = now;
  }, [endIdleSession]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isAuthenticated) return;
    cancelledRef.current = false;
    loggingOutRef.current = false;

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, markActive, {
        passive: true,
      } as AddEventListenerOptions),
    );

    const heartbeatId = window.setInterval(() => {
      void sendHeartbeatRef.current();
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
      void sendHeartbeatRef.current();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelledRef.current = true;
      window.clearInterval(heartbeatId);
      window.clearInterval(idleId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, markActive),
      );
    };
  }, [isAuthenticated, endIdleSession, markActive]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isAuthenticated) return;
    if (!shouldRecordActivity(lastActivityRef.current)) {
      endIdleSession();
      return;
    }
    lastActivityRef.current = Date.now();
    void sendHeartbeatRef.current(true);
  }, [pathname, isAuthenticated, endIdleSession]);

  return null;
}
