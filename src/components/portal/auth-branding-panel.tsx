import { LoginBrandCopy } from "@/components/portal/login-brand-copy";
import { LoginCinematicBackdrop } from "@/components/portal/login-cinematic-backdrop";

type AuthBrandingPanelProps = {
  className?: string;
};

/** Panel izquierdo de branding UAID (login, cambio de contraseña, etc.). */
export function AuthBrandingPanel({ className = "" }: AuthBrandingPanelProps) {
  return (
    <aside
      className={`relative flex flex-col items-start justify-center overflow-hidden bg-[#03060d] px-8 py-12 text-white lg:px-16 lg:py-16 ${className}`.trim()}
    >
      <LoginCinematicBackdrop />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] bg-linear-to-r from-[#03060d]/45 via-transparent to-transparent"
      />

      <LoginBrandCopy />
    </aside>
  );
}

export function AuthBrandingPanelFallback() {
  return (
    <div className="bg-linear-to-br from-[#03060d] via-slate-950 to-indigo-950" />
  );
}
