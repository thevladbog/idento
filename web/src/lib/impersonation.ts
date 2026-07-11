/**
 * Impersonation session plumbing (P1.8). The backend mints a 30-minute token
 * with an imp_by claim; the client parks the operator's own token and swaps
 * the active one. The banner (ImpersonationBanner) owns countdown + exit.
 */
export type ImpersonationSession = {
  tenantId: string;
  tenantName: string;
  expiresAt: string; // ISO from the mint response
  mintedAt: string; // ISO, stamped locally at the moment startImpersonation runs
};

const OPERATOR_TOKEN_KEY = 'operator_token';
const SESSION_KEY = 'impersonation';

export function startImpersonation(token: string, session: Omit<ImpersonationSession, 'mintedAt'>): void {
  const operatorToken = localStorage.getItem('token');
  if (operatorToken) {
    localStorage.setItem(OPERATOR_TOKEN_KEY, operatorToken);
  }
  localStorage.setItem('token', token);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, mintedAt: new Date().toISOString() }));
  window.location.href = '/dashboard';
}

/** The operator's own token, parked while an impersonation token is active — used to make authenticated requests as the operator without ending the session (e.g. the exit-summary fetch). */
export function getParkedOperatorToken(): string | null {
  return localStorage.getItem(OPERATOR_TOKEN_KEY);
}

/**
 * The operator's own user id, read from the `user` object login/register
 * already persist to localStorage — startImpersonation never touches that
 * key, so it still holds the operator's identity (not the impersonated
 * tenant's) for the duration of the session. Used to scope the exit-summary
 * action count to this operator's own requests.
 */
export function getOperatorUserId(): string | null {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const user = JSON.parse(raw) as { id?: string };
    return user.id ?? null;
  } catch {
    return null;
  }
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

export function endImpersonation(destination = '/super-admin/organizations'): void {
  clearSession(true);
  window.location.href = destination;
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
