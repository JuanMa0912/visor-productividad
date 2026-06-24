import type { TutorialStateKey } from "@/lib/ui/tutorial-keys";

const getCookieValue = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${encodeURIComponent(name)}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
};

export type TutorialRemoteResponse = {
  completed: boolean;
};

export const fetchTutorialCompletedRemote = async (
  stateKey: TutorialStateKey,
): Promise<boolean | null> => {
  try {
    const response = await fetch(
      `/api/ui-state/tutorial?key=${encodeURIComponent(stateKey)}`,
      { cache: "no-store" },
    );
    if (response.status === 401) return null;
    if (!response.ok) return null;
    const payload = (await response.json()) as TutorialRemoteResponse;
    return Boolean(payload.completed);
  } catch {
    return null;
  }
};

export const persistTutorialCompletedRemote = async (
  stateKey: TutorialStateKey,
): Promise<boolean> => {
  const csrf = getCookieValue("vp_csrf");
  if (!csrf) return false;
  try {
    const response = await fetch(
      `/api/ui-state/tutorial?key=${encodeURIComponent(stateKey)}`,
      {
        method: "POST",
        headers: { "x-csrf-token": csrf },
        cache: "no-store",
      },
    );
    return response.ok;
  } catch {
    return false;
  }
};
