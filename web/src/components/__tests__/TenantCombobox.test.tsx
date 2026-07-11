import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TenantCombobox } from '../TenantCombobox';
import '../../i18n';

const tenants = [
  { id: 't1', name: 'Acme Corp' },
  { id: 't2', name: 'Second Tenant' },
];

describe('TenantCombobox', () => {
  it('shows "All tenants" when value is empty', () => {
    render(<TenantCombobox tenants={tenants} value="" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent(/all tenants/i);
  });

  it('shows the selected tenant name when value is set', () => {
    render(<TenantCombobox tenants={tenants} value="t2" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Second Tenant');
  });

  it('calls onChange with the selected tenant id when an item is picked', () => {
    const onChange = vi.fn();
    render(<TenantCombobox tenants={tenants} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('Second Tenant'));
    expect(onChange).toHaveBeenCalledWith('t2');
  });

  it('calls onChange with an empty string when "All tenants" is picked', () => {
    const onChange = vi.fn();
    render(<TenantCombobox tenants={tenants} value="t1" onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    // The trigger shows the selected tenant's name ("Acme Corp") here, not "All
    // tenants" (see the previous test), so the "__all__" CommandItem is the only match.
    fireEvent.click(screen.getAllByText(/all tenants/i)[0]);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('still finds and selects "All tenants" when the user types a matching search query', () => {
    const onChange = vi.fn();
    render(<TenantCombobox tenants={tenants} value="t1" onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.change(screen.getByPlaceholderText(/search tenants by name/i), {
      target: { value: 'All tenants' },
    });
    const match = screen.getByText(/all tenants/i);
    fireEvent.click(match);
    expect(onChange).toHaveBeenCalledWith('');
  });
});
