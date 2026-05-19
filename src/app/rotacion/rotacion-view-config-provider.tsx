"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  ROTACION_LEGACY_VIEW,
  type RotacionViewConfig,
} from "@/app/rotacion/rotacion-view-config";

const RotacionViewConfigContext = createContext<RotacionViewConfig>(
  ROTACION_LEGACY_VIEW,
);

export function RotacionViewConfigProvider({
  config,
  children,
}: {
  config: RotacionViewConfig;
  children: ReactNode;
}) {
  const value = useMemo(() => config, [config]);
  return (
    <RotacionViewConfigContext.Provider value={value}>
      {children}
    </RotacionViewConfigContext.Provider>
  );
}

export function useRotacionViewConfig(): RotacionViewConfig {
  return useContext(RotacionViewConfigContext);
}
