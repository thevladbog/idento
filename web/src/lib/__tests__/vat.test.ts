import { describe, it, expect } from 'vitest';
import { includedVat } from '../vat';

describe('includedVat', () => {
  it('computes the VAT included in a gross amount at a given rate', () => {
    expect(includedVat(120, 20)).toBe(20);
  });

  it('rounds to two decimal places (kopecks)', () => {
    expect(includedVat(100, 20)).toBe(16.67);
  });
});
