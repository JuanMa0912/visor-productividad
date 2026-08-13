"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type UaidSurface = "light" | "dark";

const STORAGE_KEY = "uaid-surface-theme";

type UaidSurfaceThemeContextValue = {
  surface: UaidSurface;
  setSurface: (next: UaidSurface) => void;
  toggleSurface: () => void;
};

const UaidSurfaceThemeContext =
  createContext<UaidSurfaceThemeContextValue | null>(null);

const readStoredSurface = (): UaidSurface => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === "dark" || raw === "light") return raw;
  } catch {
    // ignore
  }
  return "light";
};

export function UaidSurfaceThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [surface, setSurfaceState] = useState<UaidSurface>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSurfaceState(readStoredSurface());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, surface);
    } catch {
      // ignore
    }
    document.documentElement.dataset.uaidSurface = surface;
  }, [surface, ready]);

  const setSurface = useCallback((next: UaidSurface) => {
    setSurfaceState(next);
  }, []);

  const toggleSurface = useCallback(() => {
    setSurfaceState((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  const value = useMemo(
    () => ({ surface, setSurface, toggleSurface }),
    [surface, setSurface, toggleSurface],
  );

  return (
    <UaidSurfaceThemeContext.Provider value={value}>
      {children}
    </UaidSurfaceThemeContext.Provider>
  );
}

export function useUaidSurfaceTheme(): UaidSurfaceThemeContextValue {
  const ctx = useContext(UaidSurfaceThemeContext);
  if (!ctx) {
    return {
      surface: "light",
      setSurface: () => undefined,
      toggleSurface: () => undefined,
    };
  }
  return ctx;
}
