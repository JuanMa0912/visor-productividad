const DEFAULT_DELAY_MS = 280;

export type ClickVsDouble = {
  schedule: (action: () => void) => void;
  double: (action: () => void) => void;
  clear: () => void;
};

/**
 * Separa clic de doble clic: el simple espera un instante; el doble cancela
 * esa espera y corre enseguida. Sin esto el primer clic del par dispara las dos.
 */
export function createClickVsDouble(
  delayMs = DEFAULT_DELAY_MS,
  timers: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis,
): ClickVsDouble {
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timerId == null) return;
    timers.clearTimeout(timerId);
    timerId = null;
  };

  return {
    clear,
    schedule: (action) => {
      clear();
      timerId = timers.setTimeout(() => {
        timerId = null;
        action();
      }, delayMs);
    },
    double: (action) => {
      clear();
      action();
    },
  };
}
