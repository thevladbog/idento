import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TenantIdentityHeader } from '../TenantIdentityHeader';
import '../../i18n';

describe('TenantIdentityHeader', () => {
  it('renders the tenant name, status badge, and plan badge', () => {
    render(<TenantIdentityHeader name="Acme Corp" status="suspended" planName="Professional" />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
    expect(screen.getByText('Professional')).toBeInTheDocument();
  });

  it('omits the plan badge when planName is not given', () => {
    render(<TenantIdentityHeader name="Acme Corp" status="active" />);
    expect(screen.queryByText('Professional')).not.toBeInTheDocument();
  });
});
