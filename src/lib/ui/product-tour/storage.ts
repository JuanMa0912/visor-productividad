export const buildTourLocalStorageKey = (
  baseKey: string,
  userId: string | null | undefined,
): string => (userId ? `${baseKey}.${userId}` : baseKey);

export const isTourCompletedLocally = (
  baseKey: string,
  userId: string | null | undefined,
): boolean => {
  if (typeof window === "undefined") return true;
  try {
    return (
      window.localStorage.getItem(buildTourLocalStorageKey(baseKey, userId)) ===
      "1"
    );
  } catch {
    return true;
  }
};

export const markTourCompletedLocally = (
  baseKey: string,
  userId: string | null | undefined,
): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
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
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(buildTourLocalStorageKey(baseKey, userId));
  } catch {
    /* ignore */
  }
};
