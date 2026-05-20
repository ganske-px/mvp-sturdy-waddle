import { describe, expect, it } from 'vitest';
import { hashDocument, normalizeNameForHash } from './hash';

describe('hashDocument — CPF', () => {
  it('produces the same hash for formatted and unformatted input', () => {
    const a = hashDocument('cpf', '111.444.777-35');
    const b = hashDocument('cpf', '11144477735');
    expect(a).toBe(b);
  });

  it('produces a 64-char hex string', () => {
    expect(hashDocument('cpf', '11144477735')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('zero-pads short input to 11 digits before hashing', () => {
    expect(hashDocument('cpf', '1234567891')).toBe(hashDocument('cpf', '01234567891'));
  });
});

describe('hashDocument — CNPJ', () => {
  it('produces the same hash for formatted and unformatted input', () => {
    const a = hashDocument('cnpj', '11.222.333/0001-81');
    const b = hashDocument('cnpj', '11222333000181');
    expect(a).toBe(b);
  });

  it('produces a 64-char hex string', () => {
    expect(hashDocument('cnpj', '11222333000181')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashDocument — name', () => {
  it('is case-insensitive', () => {
    const a = hashDocument('name', 'João Silva');
    const b = hashDocument('name', 'JOÃO SILVA');
    const c = hashDocument('name', 'joão silva');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('collapses internal whitespace and trims', () => {
    expect(hashDocument('name', '  João   Silva  ')).toBe(hashDocument('name', 'João Silva'));
  });

  it('produces a 64-char hex string', () => {
    expect(hashDocument('name', 'João Silva')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashDocument — cross-type separation', () => {
  it('produces different hashes for the same digit string across types', () => {
    expect(hashDocument('cpf', '12345678901')).not.toBe(hashDocument('cnpj', '12345678901'));
  });

  it('produces different hashes for the same string across cpf and name', () => {
    expect(hashDocument('cpf', '12345678901')).not.toBe(hashDocument('name', '12345678901'));
  });
});

describe('hashDocument — invalid input', () => {
  it('throws on empty string', () => {
    expect(() => hashDocument('cpf', '')).toThrow();
    expect(() => hashDocument('cnpj', '')).toThrow();
    expect(() => hashDocument('name', '')).toThrow();
  });

  it('throws on a name that normalizes to empty', () => {
    expect(() => hashDocument('name', '    ')).toThrow();
  });

  it('throws on a CPF that does not normalize to 11 digits', () => {
    expect(() => hashDocument('cpf', '12345678901234')).toThrow();
  });

  it('throws on a CNPJ that does not normalize to 14 digits', () => {
    expect(() => hashDocument('cnpj', '1112223334445556')).toThrow();
  });
});

describe('normalizeNameForHash', () => {
  it('uppercases and collapses whitespace', () => {
    expect(normalizeNameForHash('  João   Silva  ')).toBe('JOÃO SILVA');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeNameForHash('   ')).toBe('');
  });
});
