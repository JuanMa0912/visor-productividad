export const buildTourLocalStorageKey = (
  baseKey: string,
  userId: string | null | undefined,
): string => (userId ? `${baseKey}.${userId}` : baseKey);

const canUseLocalStorage = (): boolean =>
  typeof globalThis.localStorage !== "undefined";

const readTourCompletedFlag = (key: string): boolean => {
  if (!canUseLocalStorage()) return true;
  try {
    return globalThis.localStorage.getItem(key) === "1";
  } catch {
    return true;
  }
};

export const isTourCompletedLocally = (
  baseKey: string,
  userId: string | null | undefined,
): boolean => {
  if (!canUseLocalStorage()) return true;
  const keyed = buildTourLocalStorageKey(baseKey, userId);
  if (readTourCompletedFlag(keyed)) return true;
  // Compat: tours marcados antes de tener userId en la clave.
  if (userId && keyed !== baseKey && readTourCompletedFlag(baseKey)) return true;
  return false;
};

export const markTourCompletedLocally = (
  baseKey: string,
  userId: string | null | undefined,
): void => {
  if (!canUseLocalStorage()) return;
  try {
    globalThis.localStorage.setItem(
      buildTourLocalStorageKey(baseKey, userId),
      "1",
    );
  } catch {
    /* quota / private mode */
  }
};

export const clearTourCompletedLocally = (
  baseKey: string,
  userId: string | null | undefined,
): void => {
  if (!canUseLocalStorage()) return;
  try {
    globalThis.localStorage.removeItem(buildTourLocalStorageKey(baseKey, userId));
  } catch {
    /* ignore */
  }
};
