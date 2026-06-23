import type { RotacionTutorialStateResponse } from "@/lib/rotacion/tutorial-state";
import { getCookieValue } from "./rotacion-preamble";

export const fetchRotacionTourCompletedRemote = async (): Promise<
  boolean | null
> => {
  try {
    const response = await fetch("/api/rotacion/tutorial", {
      cache: "no-store",
    });
    if (response.status === 401) return null;
    if (!response.ok) return null;
    const payload = (await response.json()) as RotacionTutorialStateResponse;
    return Boolean(payload.completed);
  } catch {
    return null;
  }
};

export const persistRotacionTourCompletedRemote = async (): Promise<boolean> => {
  const csrf = getCookieValue("vp_csrf");
  if (!csrf) return false;
  try {
    const response = await fetch("/api/rotacion/tutorial", {
      method: "POST",
      headers: { "x-csrf-token": csrf },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
};
