import api from './api';

export type InstanceInfo = {
  mode: 'saas' | 'onprem';
  version: string;
  license: unknown;
};

let cached: Promise<InstanceInfo> | null = null;

/**
 * Fetches GET /api/instance once per page load and memoizes the result —
 * the deployment mode is a build/deploy-time value, never changes while a
 * tab is open. On failure, resolves to `{mode: 'onprem', ...}`: the same
 * safe default the backend itself uses for DEPLOYMENT_MODE, so a network
 * hiccup fails toward hiding saas-only surfaces, never toward exposing
 * them.
 */
export function getInstanceInfo(): Promise<InstanceInfo> {
  if (!cached) {
    cached = api
      .get('/api/instance')
      .then((res) => res.data as InstanceInfo)
      .catch(() => ({ mode: 'onprem' as const, version: 'unknown', license: null }));
  }
  return cached;
}
