"use client";

import { resolveVariationChip } from "@/lib/informe-variacion/format";
import { cn } from "@/lib/shared/utils";

const chipClass = (kind: ReturnType<typeof resolveVariationChip>["kind"]) => {
  switch (kind) {
    case "positive":
      return "bg-emerald-100 text-emerald-700";
    case "negative":
      return "bg-rose-100 text-rose-700";
    case "new":
      return "bg-slate-100 text-slate-500";
    default:
      return "bg-slate-100 text-slate-400";
  }
};

export function VariationChip({
  current,
  previous,
  yoyOk = true,
}: {
  current: number;
  previous: number;
  yoyOk?: boolean;
}) {
  const chip = resolveVariationChip(current, previous, yoyOk);
  return (
    <span
      className={cn(
        "inline-flex min-w-[4rem] justify-center rounded-full px-2 py-0.5 text-xs font-semibold",
        chipClass(chip.kind),
      )}
    >
      {chip.label}
    </span>
  );
}
