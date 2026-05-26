import KardexPageClient from "./page-client";
import { AppTopBar } from "@/components/portal/app-top-bar";

export default function KardexPage() {
  return (
    <>
      <AppTopBar />
      <KardexPageClient />
    </>
  );
}
