/**
 * Impersonation session plumbing (P1.8). The backend mints a 30-minute token
 * with an imp_by claim; the client parks the operator's own token and swaps
 * the active one. The banner (ImpersonationBanner) owns countdown + exit.
 *
 * SECURITY NOTE: the parked operator token is the operator's FULL
 * credential, not a reduced artifact -- anyone who can read localStorage
 * during an impersonation session holds both the impersonation token AND
 * the operator's own session. That is inherent to the park-and-swap design;
 * keep the session window short and never widen what gets parked.
 */
export type ImpersonationSession = {
  tenantId: string;
  tenantName: string;
  expiresAt: string; // ISO from the mint response
  mintedAt: string; // ISO, stamped locally at the moment startImpersonation runs
  /**
   * Fingerprint of the impersonation token this session swapped in -- the
   * same string held in localStorage 'token' for the session's duration
   * (no additional credential exposure). clearSession restores the parked
   * operator token ONLY while the active token still matches, so a newer
   * session started elsewhere can never be clobbered by stale artifacts.
   * Optional: sessions persisted before the fingerprint existed restore
   * unconditionally (legacy behavior).
   */
  impToken?: string;
};

const OPERATOR_TOKEN_KEY = 'operator_token';
const SESSION_KEY = 'impersonation';

export function startImpersonation(token: string, session: Omit<ImpersonationSession, 'mintedAt'>): void {
  const operatorToken = localStorage.getItem('token');
  if (operatorToken) {
    localStorage.setItem(OPERATOR_TOKEN_KEY, operatorToken);
  }
  localStorage.setItem('token', token);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, mintedAt: new Date().toISOString(), impToken: token }));
  // Post-cutover the tenant workspace is the panel SPA at '/' (same origin);
  // it reads the shared token and renders its own impersonation banner (P0.2).
  window.location.href = '/';
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
  // Fingerprint guard: only swap tokens while the active token is still the
  // impersonation token this session installed. If it changed (another tab
  // logged in fresh, stale artifacts from an older session), leave 'token'
  // alone -- clobbering a newer legitimate session with the old parked
  // credential is worse than leaving artifacts to expire.
  let fingerprintOk = true;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const session = raw ? (JSON.parse(raw) as ImpersonationSession) : null;
    if (session?.impToken) {
      fingerprintOk = localStorage.getItem('token') === session.impToken;
    }
  } catch {
    // Unparseable session record: treat as legacy (restore unconditionally).
  }
  if (restoreToken && fingerprintOk) {
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
