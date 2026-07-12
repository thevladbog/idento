import { useEffect, useState } from 'react';
import { getInstanceInfo } from '@/lib/instance';

/**
 * Returns the current deployment mode, defaulting to 'onprem' (the safe
 * default) until the one-time GET /api/instance fetch resolves.
 */
export function useInstanceMode(): { mode: 'saas' | 'onprem'; loading: boolean } {
  const [mode, setMode] = useState<'saas' | 'onprem'>('onprem');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getInstanceInfo().then((info) => {
      if (!cancelled) {
        setMode(info.mode);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { mode, loading };
}
