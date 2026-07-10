/**
 * Impersonation session plumbing (P1.8). The backend mints a 30-minute token
 * with an imp_by claim; the client parks the operator's own token and swaps
 * the active one. The banner (ImpersonationBanner) owns countdown + exit.
 */
export type ImpersonationSession = {
  tenantId: string;
  tenantName: string;
  expiresAt: string; // ISO from the mint response
};

const OPERATOR_TOKEN_KEY = 'operator_token';
const SESSION_KEY = 'impersonation';

export function startImpersonation(token: string, session: ImpersonationSession): void {
  const operatorToken = localStorage.getItem('token');
  if (operatorToken) {
    localStorage.setItem(OPERATOR_TOKEN_KEY, operatorToken);
  }
  localStorage.setItem('token', token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.location.href = '/dashboard';
}

function clearSession(restoreToken: boolean): void {
  const operatorToken = localStorage.getItem(OPERATOR_TOKEN_KEY);
  if (restoreToken) {
    if (operatorToken) localStorage.setItem('token', operatorToken);
    else localStorage.removeItem('token'); // fail safe: never keep the imp token
  }
  localStorage.removeItem(OPERATOR_TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function endImpersonation(): void {
  clearSession(true);
  window.location.href = '/super-admin/organizations';
}

/**
 * Removes any impersonation artifacts WITHOUT restoring the parked token.
 * Called on every successful authentication: a fresh login is a hard auth
 * boundary — no prior operator session may survive it.
 */
export function clearImpersonationArtifacts(): void {
  localStorage.removeItem(OPERATOR_TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function getImpersonation(): ImpersonationSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as ImpersonationSession;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      // Session lapsed: restore the operator silently on next read (no redirect).
      clearSession(true);
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}
