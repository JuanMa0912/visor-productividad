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
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <AuthBrandingPanelFallback />
      <div className="login-form-aurora flex items-center justify-center px-6">
        <div className="h-[360px] w-full max-w-sm animate-pulse rounded-3xl bg-white/50" />
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
