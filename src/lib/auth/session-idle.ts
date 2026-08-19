/** Minutos sin mouse/teclado/clic/navegación antes de cerrar la sesión. */
export const SESSION_IDLE_MINUTES = 60;
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
