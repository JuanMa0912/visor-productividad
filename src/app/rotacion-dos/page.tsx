"use client";

import { RotacionPageInner } from "@/app/rotacion/page";
import { RotacionViewConfigProvider } from "@/app/rotacion/rotacion-view-config-provider";
import { ROTACION_V4_VIEW } from "@/app/rotacion/rotacion-view-config";

export default function RotacionDosPage() {
  return (
    <RotacionViewConfigProvider config={ROTACION_V4_VIEW}>
      <RotacionPageInner />
    </RotacionViewConfigProvider>
  );
}
