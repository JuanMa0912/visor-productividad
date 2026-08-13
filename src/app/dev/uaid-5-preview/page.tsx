"use client";

import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import {
  CONTROL_ROOM_MODULES,
  PortalControlRoom,
  type ControlRoomDomain,
} from "@/components/portal/portal-control-room";
import { useUaidSurfaceTheme } from "@/components/portal/uaid-surface-theme";
import { PORTAL_APP_VERSION } from "@/lib/shared/uaid-brand";

const PREVIEW_DOMAINS: ControlRoomDomain[] = [
  {
    id: "venta",
    label: "Venta",
    focus: "Resultado comercial",
    description:
      "Participación, proveedores y ventas por ítem — hacia dónde va la demanda.",
    hubHref: "/venta",
    accent: "venta",
  },
  {
    id: "producto",
    label: "Producto",
    focus: "Causa y comportamiento",
    description:
      "Márgenes, rotación e informe de variación — dónde está el riesgo.",
    hubHref: "/productividad",
    accent: "producto",
  },
  {
    id: "operacion",
    label: "Operación",
    focus: "Ejecución en piso",
    description:
      "Consulta operativa, checklists y horarios — el día a día por sede.",
    hubHref: "/horario",
    accent: "operacion",
  },
];

/**
 * Preview visual UAID 5.0 sin sesión (solo next dev).
 */
export default function Uaid5VisualPreviewPage() {
  const { surface } = useUaidSurfaceTheme();
  const dark = surface === "dark";

  if (process.env.NODE_ENV !== "development") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-sm text-slate-500">
        Preview solo disponible en desarrollo.
      </div>
    );
  }

  return (
    <div className={dark ? "min-h-screen bg-[#070b14]" : "min-h-screen bg-slate-50"}>
      <div
        className={
          dark
            ? "border-b border-amber-400/30 bg-amber-500/15 px-4 py-2 text-center text-xs font-medium text-amber-100"
            : "border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900"
        }
      >
        Preview UAID {PORTAL_APP_VERSION} sin sesion · modo{" "}
        {dark ? "oscuro" : "claro (principal)"} · solo{" "}
        <span className="font-mono">next dev</span>
        {" · "}
        <a
          href="/dev/uaid-5-preview/usuarios"
          className="font-semibold underline underline-offset-2"
        >
          Admin Usuarios
        </a>
      </div>
      <PortalBrandingHeader
        canAccessCronograma
        isAdmin
        username="preview"
        sede="Demo"
        showSeccionesShortcut={false}
      />
      <PortalControlRoom
        domains={PREVIEW_DOMAINS}
        modules={CONTROL_ROOM_MODULES}
        onOpen={() => undefined}
      />
    </div>
  );
}
