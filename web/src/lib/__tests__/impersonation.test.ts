import { describe, it, expect, beforeEach } from 'vitest';
import { startImpersonation, getImpersonation, getParkedOperatorToken } from '../impersonation';

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
