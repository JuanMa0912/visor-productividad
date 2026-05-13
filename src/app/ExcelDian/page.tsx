import type { Metadata } from "next";
import { ExcelDianPanel } from "./excel-dian-panel";

export const metadata: Metadata = {
  title: "Excel DIAN",
  description: "Exportación Excel para reportes DIAN.",
};

export default function ExcelDianPage() {
  return <ExcelDianPanel />;
}
