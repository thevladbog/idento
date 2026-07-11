import axios from 'axios';

export type ImpersonationSummary = {
  durationMinutes: number;
  actionCount: number;
};

const PAGE_SIZE = 100;

/**
 * Fetches the exit summary for an impersonation session, authenticating
 * with the parked OPERATOR token directly (not the shared `api` client,
 * whose active token during a session is the impersonation token — this
 * call must succeed regardless of that token's own super-admin resolution).
 *
 * Pages through the audit log (newest-first) until an entry older than
 * `mintedAt` is reached, so `actionCount` isn't capped at a single page for
 * long sessions. Counts only rows attributed to `operatorUserId`, since
 * another operator's overlapping session against the same tenant would
 * otherwise inflate this operator's count.
 */
export async function fetchImpersonationSummary(
  tenantId: string,
  mintedAt: string,
  operatorToken: string,
  operatorUserId: string
): Promise<ImpersonationSummary> {
  const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:8008';
  const headers = { Authorization: `Bearer ${operatorToken}` };
  const since = new Date(mintedAt).getTime();

  let offset = 0;
  let actionCount = 0;
  for (;;) {
    const { data } = await axios.get(`${baseURL}/api/super-admin/audit-log`, {
      headers,
      params: { target_id: tenantId, action: 'impersonated_request', limit: PAGE_SIZE, offset },
    });
    const entries: Array<{ created_at: string; admin_user_id: string }> = data.logs ?? [];
    const total: number = typeof data.total === 'number' ? data.total : offset + entries.length;

    let reachedOlderEntry = false;
    for (const entry of entries) {
      if (new Date(entry.created_at).getTime() < since) {
        reachedOlderEntry = true;
        break;
      }
      if (entry.admin_user_id === operatorUserId) {
        actionCount += 1;
      }
    }

    offset += entries.length;
    if (reachedOlderEntry || entries.length === 0 || offset >= total) break;
  }

  const durationMinutes = Math.max(0, Math.round((Date.now() - since) / 60000));
  return { durationMinutes, actionCount };
}
