import { NextResponse } from "next/server";
import { isLocalPortalMigrationNoticeEnabled } from "@/lib/shared/local-portal-notices";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    enabled: isLocalPortalMigrationNoticeEnabled(),
  });
}
