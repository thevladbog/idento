/**
 * Computes the VAT amount already included in a gross price, given the
 * VAT rate as a percentage (e.g. 20 for 20%).
 *
 * amount is VAT-inclusive; the net price is amount / (1 + rate/100), so
 * the included tax is amount - net = amount * rate / (100 + rate).
 * Rounded to kopecks (2 decimal places) since amounts are in rubles.
 */
export function includedVat(amount: number, rate: number): number {
  return Math.round(((amount * rate) / (100 + rate)) * 100) / 100;
}
