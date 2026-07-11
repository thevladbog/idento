import { describe, it, expect } from 'vitest';
import { meterTone, meterPercent, meterToneClass } from '../meters';

describe('meterTone', () => {
  it('returns unlimited when limit is -1', () => {
    expect(meterTone(5000, -1)).toBe('unlimited');
  });
  it('returns ok when under 80%', () => {
    expect(meterTone(79, 100)).toBe('ok');
  });
  it('returns warn at exactly 80%', () => {
    expect(meterTone(80, 100)).toBe('warn');
  });
  it('returns warn between 80% and 100%', () => {
    expect(meterTone(95, 100)).toBe('warn');
  });
  it('returns over at exactly 100%', () => {
    expect(meterTone(100, 100)).toBe('over');
  });
  it('returns over above 100%', () => {
    expect(meterTone(122, 100)).toBe('over');
  });
  it('treats a zero limit as unlimited-safe (no divide by zero, returns over only if count > 0)', () => {
    expect(meterTone(0, 0)).toBe('ok');
    expect(meterTone(1, 0)).toBe('over');
  });
});

describe('meterPercent', () => {
  it('computes a clamped 0-100 percent', () => {
    expect(meterPercent(50, 100)).toBe(50);
    expect(meterPercent(150, 100)).toBe(100);
    expect(meterPercent(0, 100)).toBe(0);
  });
  it('returns 0 for unlimited (-1) limits', () => {
    expect(meterPercent(5000, -1)).toBe(0);
  });
  it('returns 100 for a zero limit with nonzero usage, matching the over tone', () => {
    expect(meterPercent(5, 0)).toBe(100);
  });
  it('returns 0 for a zero limit with zero usage', () => {
    expect(meterPercent(0, 0)).toBe(0);
  });
});

describe('meterToneClass', () => {
  it('maps each tone to a distinct class string', () => {
    expect(meterToneClass('ok')).toContain('primary');
    expect(meterToneClass('warn')).toMatch(/amber|yellow/);
    expect(meterToneClass('over')).toBe('text-destructive');
    expect(meterToneClass('unlimited')).toContain('muted');
  });
});
