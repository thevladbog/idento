import { describe, it, expect } from 'vitest';
import { isActiveNavPath } from '@/lib/navUtils';

describe('isActiveNavPath', () => {
  it('matches the dashboard root only on an exact path', () => {
    expect(isActiveNavPath('/super-admin', '/super-admin')).toBe(true);
    expect(isActiveNavPath('/super-admin', '/super-admin/organizations')).toBe(false);
  });

  it('matches nested routes by prefix for non-root items', () => {
    expect(isActiveNavPath('/super-admin/organizations', '/super-admin/organizations')).toBe(true);
    expect(isActiveNavPath('/super-admin/organizations', '/super-admin/organizations/abc-123')).toBe(true);
    expect(isActiveNavPath('/super-admin/organizations', '/super-admin/plans')).toBe(false);
  });

  it('does not cross-match distinct top-level sections that share a prefix', () => {
    expect(isActiveNavPath('/super-admin/users', '/super-admin/organizations')).toBe(false);
  });

  it('does not match a route that merely shares a prefix', () => {
    expect(isActiveNavPath('/super-admin/organizations', '/super-admin/organizations-legacy')).toBe(false);
  });
});
