/** Minutos sin clic/teclado/toque/navegación antes de cerrar la sesión. */
export const SESSION_IDLE_MINUTES = 5;
export const SESSION_IDLE_MS = SESSION_IDLE_MINUTES * 60 * 1000;

export const LOGIN_IDLE_QUERY = "inactividad";

export const loginUrlAfterIdle = () => `/login?razon=${LOGIN_IDLE_QUERY}`;

export const isSessionIdle = (
  lastActivityAtMs: number,
  nowMs = Date.now(),
): boolean => {
  if (!Number.isFinite(lastActivityAtMs) || lastActivityAtMs <= 0) return true;
  return nowMs - lastActivityAtMs >= SESSION_IDLE_MS;
};

/**
 * Un gesto nuevo no “salva” una sesión que ya cruzó el umbral de idle.
 * Si no, un scroll o clic al volver a la pestaña reinicia el reloj.
 */
export const shouldRecordActivity = (
  lastActivityAtMs: number,
  nowMs = Date.now(),
): boolean => !isSessionIdle(lastActivityAtMs, nowMs);

/**
 * PresenceHeartbeat vive en el layout y no se desmonta al ir a /login.
 * Si no se reinicia el reloj al volver a autenticar, un idle previo
 * (p. ej. timeout de 5 min) sigue “activo” y vuelve a cerrar la sesión
 * apenas el usuario entra, hasta que recarga con F5.
 */
export const shouldResetIdleClockOnAuthChange = (
  wasAuthenticated: boolean,
  isAuthenticated: boolean,
): boolean => isAuthenticated && !wasAuthenticated;
