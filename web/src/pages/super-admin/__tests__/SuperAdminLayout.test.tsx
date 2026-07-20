import { describe, it, expect } from 'vitest';
import { isActiveNavPath } from '@/lib/navUtils';

// Paths here are relative to the app's basename ("/super-admin", set on
// BrowserRouter in App.tsx), matching what useLocation().pathname and the
// menuItems in SuperAdminLayout actually use post-rebase.
describe('isActiveNavPath', () => {
  it('matches the dashboard root only on an exact path', () => {
    expect(isActiveNavPath('/', '/')).toBe(true);
    expect(isActiveNavPath('/', '/organizations')).toBe(false);
  });

  it('matches nested routes by prefix for non-root items', () => {
    expect(isActiveNavPath('/organizations', '/organizations')).toBe(true);
    expect(isActiveNavPath('/organizations', '/organizations/abc-123')).toBe(true);
    expect(isActiveNavPath('/organizations', '/plans')).toBe(false);
  });

  it('does not cross-match distinct top-level sections that share a prefix', () => {
    expect(isActiveNavPath('/users', '/organizations')).toBe(false);
  });

  it('does not match a route that merely shares a prefix', () => {
    expect(isActiveNavPath('/organizations', '/organizations-legacy')).toBe(false);
  });
});
