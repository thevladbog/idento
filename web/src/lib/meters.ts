export type MeterTone = 'ok' | 'warn' | 'over' | 'unlimited';

/** Limits use the codebase-wide convention: -1 means unlimited (see backend/internal/store/seed.go). */
const UNLIMITED = -1;

export function meterTone(count: number, limit: number): MeterTone {
  if (limit === UNLIMITED) return 'unlimited';
  if (limit === 0) return count > 0 ? 'over' : 'ok';
  const pct = (count / limit) * 100;
  if (pct >= 100) return 'over';
  if (pct >= 80) return 'warn';
  return 'ok';
}

export function meterPercent(count: number, limit: number): number {
  if (limit === UNLIMITED) return 0;
  if (limit === 0) return count > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((count / limit) * 100)));
}

export function meterToneClass(tone: MeterTone): string {
  switch (tone) {
    case 'over':
      return 'text-destructive';
    case 'warn':
      return 'text-amber-600 dark:text-amber-400';
    case 'unlimited':
      return 'text-muted-foreground';
    case 'ok':
    default:
      return 'text-primary';
  }
}
