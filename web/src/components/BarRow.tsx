export function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div
        className="h-3 rounded bg-primary"
        style={{ width: `${max > 0 ? Math.max(4, (count / max) * 100) : 4}%` }}
      />
      <span className="tabular-nums">{count}</span>
    </div>
  );
}
