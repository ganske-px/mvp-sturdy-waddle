import { describe, expect, it } from 'vitest';
import { generateStrongPassword, validateTempPassword } from './password';

describe('validateTempPassword', () => {
  it('rejects strings shorter than 12 chars', () => {
    expect(validateTempPassword('short')).toEqual({
      ok: false,
      error: 'A senha precisa ter pelo menos 12 caracteres.',
    });
  });
  it('rejects empty strings', () => {
    expect(validateTempPassword('')).toEqual({
      ok: false,
      error: 'A senha precisa ter pelo menos 12 caracteres.',
    });
  });
  it('accepts strings ≥12 chars', () => {
    expect(validateTempPassword('Twelve-chars')).toEqual({ ok: true });
    expect(validateTempPassword('a'.repeat(64))).toEqual({ ok: true });
  });
});

describe('generateStrongPassword', () => {
  it('produces ≥16 chars by default', () => {
    expect(generateStrongPassword().length).toBeGreaterThanOrEqual(16);
  });
  it('respects custom length ≥12', () => {
    expect(generateStrongPassword(20).length).toBe(20);
  });
  it('throws on length < 12', () => {
    expect(() => generateStrongPassword(8)).toThrow(/12/);
  });
  it('contains at least one of each class', () => {
    const pw = generateStrongPassword();
    expect(/[a-z]/.test(pw)).toBe(true);
    expect(/[A-Z]/.test(pw)).toBe(true);
    expect(/\d/.test(pw)).toBe(true);
    expect(/[!@#$%^&*\-_=+]/.test(pw)).toBe(true);
  });
});
