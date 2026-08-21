import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthBrandingPanelFallback } from "@/components/portal/auth-branding-panel";
import {
  getLocalPortalCloudUrl,
  isLocalPortalClosed,
} from "@/lib/shared/local-portal-notices";
import { LoginPageInner } from "./login-inner";

function LoginPageFallback() {
  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <AuthBrandingPanelFallback />
      <div className="login-form-aurora flex items-center justify-center px-6">
        <div className="h-[320px] w-full max-w-lg animate-pulse rounded-3xl bg-white/50" />
      </div>
    </div>
  );
}

export default function LoginPage() {
  if (isLocalPortalClosed()) {
    redirect(getLocalPortalCloudUrl());
  }

  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageInner />
    </Suspense>
  );
}
