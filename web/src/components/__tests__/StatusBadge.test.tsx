import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge';
import '../../i18n';

describe('StatusBadge', () => {
  it('renders the active status with the translated label', () => {
    render(<StatusBadge status="active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders a distinct trial status, not the raw fallback string', () => {
    render(<StatusBadge status="trial" />);
    const badge = screen.getByText('Trial');
    expect(badge).toBeInTheDocument();
    expect(badge.className).not.toBe('');
  });

  it('renders suspended and archived with their existing classes', () => {
    const { rerender } = render(<StatusBadge status="suspended" />);
    expect(screen.getByText('Suspended').className).toContain('amber');
    rerender(<StatusBadge status="archived" />);
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('defaults to active when status is undefined', () => {
    render(<StatusBadge />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
