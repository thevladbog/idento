import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarRow } from '../BarRow';

describe('BarRow', () => {
  it('renders the label and count', () => {
    render(<BarRow label="Mon" count={42} max={100} />);
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('gives a minimum visible width even for a zero count', () => {
    const { container } = render(<BarRow label="Tue" count={0} max={100} />);
    const bar = container.querySelector('[style*="width"]');
    expect(bar).toBeTruthy();
    const width = bar?.getAttribute('style') || '';
    expect(width).toContain('4%');
  });
});
