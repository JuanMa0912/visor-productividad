import { Suspense } from "react";
import {
  AuthBrandingPanelFallback,
} from "@/components/portal/auth-branding-panel";
import { LocalPortalClosedPanel } from "@/components/portal/local-portal-closed-panel";
import {
  getLocalPortalCloudUrl,
  isLocalPortalClosed,
} from "@/lib/shared/local-portal-notices";
import { LoginPageInner } from "./login-inner";

function LoginPageFallback() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <AuthBrandingPanelFallback />
      <div className="flex items-center justify-center bg-slate-50 px-6">
        <div className="h-[360px] w-full max-w-sm animate-pulse rounded-2xl bg-slate-200/60" />
      </div>
    </div>
  );
}

export default function LoginPage() {
  if (isLocalPortalClosed()) {
    return <LocalPortalClosedPanel cloudUrl={getLocalPortalCloudUrl()} />;
  }

  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageInner />
    </Suspense>
  );
}
