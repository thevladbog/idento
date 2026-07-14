export interface ImpersonationSession {
  tenantId: string;
  tenantName: string;
  expiresAt: string;
  mintedAt: string;
}

const SESSION_KEY = "impersonation";
const OPERATOR_TOKEN_KEY = "operator_token";
const TOKEN_KEY = "token";

export function getImpersonation(): ImpersonationSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  let session: ImpersonationSession;
  try {
    session = JSON.parse(raw) as ImpersonationSession;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    endImpersonation();
    return null;
  }
  return session;
}

export function endImpersonation(): void {
  const operatorToken = localStorage.getItem(OPERATOR_TOKEN_KEY);
  if (operatorToken) localStorage.setItem(TOKEN_KEY, operatorToken);
  else localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(OPERATOR_TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}
