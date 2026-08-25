import { describe, it, expect, beforeEach } from 'vitest';
import { startImpersonation, getImpersonation, getParkedOperatorToken } from '../impersonation';

function expiredSession(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tenantId: 't1',
    tenantName: 'Acme Corp',
    expiresAt: new Date(Date.now() - 60000).toISOString(),
    mintedAt: new Date(Date.now() - 30 * 60000).toISOString(),
    ...extra,
  });
}

describe('impersonation session mintedAt + parked token', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'operator-token-abc');
  });

  it('stamps mintedAt automatically and parks the operator token, without requiring callers to pass it', () => {
    const before = Date.now();
    try {
      startImpersonation('imp-token-xyz', {
        tenantId: 't1',
        tenantName: 'Acme Corp',
        expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
      });
    } catch {
      // jsdom throws "not implemented" for window.location.href navigation;
      // only the localStorage side effects are under test here.
    }
    const session = getImpersonation();
    expect(session).not.toBeNull();
    expect(new Date(session!.mintedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(getParkedOperatorToken()).toBe('operator-token-abc');
  });
});

// Backlog item "imp-token fingerprint hardening in clearSession": restoring
// the parked operator token must be conditional on the CURRENT token still
// being the impersonation token the session was started with. If 'token'
// has since been replaced by some other legitimate session (another tab,
// stale artifacts), a lapsed-session cleanup must clear the artifacts but
// never clobber the newer token with the old parked one.
describe('clearSession fingerprint guard (via lapsed-session cleanup)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('restores the parked operator token when the current token is still the fingerprinted imp token', () => {
    localStorage.setItem('token', 'imp-token-xyz');
    localStorage.setItem('operator_token', 'operator-token-abc');
    localStorage.setItem('impersonation', expiredSession({ impToken: 'imp-token-xyz' }));

    expect(getImpersonation()).toBeNull();
    expect(localStorage.getItem('token')).toBe('operator-token-abc');
    expect(localStorage.getItem('operator_token')).toBeNull();
    expect(localStorage.getItem('impersonation')).toBeNull();
  });

  it('never clobbers a token that is no longer the fingerprinted imp token', () => {
    localStorage.setItem('token', 'fresh-newer-session-token');
    localStorage.setItem('operator_token', 'stale-operator-token');
    localStorage.setItem('impersonation', expiredSession({ impToken: 'imp-token-xyz' }));

    expect(getImpersonation()).toBeNull();
    expect(localStorage.getItem('token')).toBe('fresh-newer-session-token');
    expect(localStorage.getItem('operator_token')).toBeNull();
    expect(localStorage.getItem('impersonation')).toBeNull();
  });

  it('keeps legacy behavior for sessions persisted before the fingerprint existed', () => {
    localStorage.setItem('token', 'imp-token-xyz');
    localStorage.setItem('operator_token', 'operator-token-abc');
    localStorage.setItem('impersonation', expiredSession());

    expect(getImpersonation()).toBeNull();
    expect(localStorage.getItem('token')).toBe('operator-token-abc');
  });

  it('startImpersonation stamps the fingerprint into the session record', () => {
    localStorage.setItem('token', 'operator-token-abc');
    try {
      startImpersonation('imp-token-xyz', {
        tenantId: 't1',
        tenantName: 'Acme Corp',
        expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
      });
    } catch {
      // jsdom navigation throw; localStorage side effects are under test.
    }
    const raw = JSON.parse(localStorage.getItem('impersonation') ?? '{}') as { impToken?: string };
    expect(raw.impToken).toBe('imp-token-xyz');
  });
});
