import axios from 'axios';

export type ImpersonationSummary = {
  durationMinutes: number;
  actionCount: number;
};

/**
 * Fetches the exit summary for an impersonation session, authenticating
 * with the parked OPERATOR token directly (not the shared `api` client,
 * whose active token during a session is the impersonation token — this
 * call must succeed regardless of that token's own super-admin resolution).
 */
export async function fetchImpersonationSummary(
  tenantId: string,
  mintedAt: string,
  operatorToken: string
): Promise<ImpersonationSummary> {
  const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:8008';
  const { data } = await axios.get(`${baseURL}/api/super-admin/audit-log`, {
    headers: { Authorization: `Bearer ${operatorToken}` },
    params: { target_id: tenantId, action: 'impersonated_request' },
  });
  const entries: Array<{ created_at: string }> = data.logs ?? [];
  const since = new Date(mintedAt).getTime();
  const relevant = entries.filter((e) => new Date(e.created_at).getTime() >= since);
  const durationMinutes = Math.max(0, Math.round((Date.now() - since) / 60000));
  return { durationMinutes, actionCount: relevant.length };
}
