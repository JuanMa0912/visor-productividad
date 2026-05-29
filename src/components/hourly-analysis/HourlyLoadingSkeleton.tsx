export const HourlyLoadingSkeleton = () => (
  <div className="space-y-3 animate-pulse">
    {Array.from({ length: 14 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3">
        <div className="h-4 w-16 shrink-0 rounded-full bg-slate-200/70" />
        <div className="h-9 flex-1 rounded-full bg-slate-200/70" />
        <div className="h-4 w-24 shrink-0 rounded-full bg-slate-200/70" />
      </div>
    ))}
  </div>
);
