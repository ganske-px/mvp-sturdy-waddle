import { describe, expect, it } from 'vitest';
import { format, isValid, mask, normalize } from './cnpj';

describe('cnpj.normalize', () => {
  it('strips non-digit characters', () => {
    expect(normalize('11.222.333/0001-81')).toBe('11222333000181');
  });

  it('zero-pads short input to 14 digits', () => {
    expect(normalize('1222333000181')).toBe('01222333000181');
  });

  it('returns empty string for empty input', () => {
    expect(normalize('')).toBe('');
  });

  it('preserves 14-digit input unchanged', () => {
    expect(normalize('11222333000181')).toBe('11222333000181');
  });

  it('returns empty for input longer than 14 digits', () => {
    expect(normalize('112223330001810')).toBe('');
  });

  it('handles mixed punctuation', () => {
    expect(normalize(' 11 222 333/0001-81 ')).toBe('11222333000181');
  });
});

describe('cnpj.isValid', () => {
  it('accepts a known-valid CNPJ', () => {
    expect(isValid('11.222.333/0001-81')).toBe(true);
    expect(isValid('11222333000181')).toBe(true);
  });

  it('rejects a CNPJ with a wrong check digit', () => {
    expect(isValid('11.222.333/0001-82')).toBe(false);
  });

  it('rejects CNPJs of all identical digits', () => {
    expect(isValid('11.111.111/1111-11')).toBe(false);
    expect(isValid('00000000000000')).toBe(false);
  });

  it('rejects inputs that are not 14 digits long', () => {
    expect(isValid('1222333000181')).toBe(false);
    expect(isValid('112223330001810')).toBe(false);
    expect(isValid('')).toBe(false);
  });

  it('rejects inputs that are not numeric', () => {
    expect(isValid('abcdefghijklmn')).toBe(false);
  });

  it('accepts another known-valid CNPJ', () => {
    expect(isValid('45.997.418/0001-53')).toBe(true);
  });
});

describe('cnpj.format', () => {
  it('formats raw digits with the canonical CNPJ mask', () => {
    expect(format('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('passes through already-formatted CNPJs after normalization', () => {
    expect(format('11.222.333/0001-81')).toBe('11.222.333/0001-81');
  });

  it('returns empty string for empty input', () => {
    expect(format('')).toBe('');
  });

  it('returns the original input when not 14 digits', () => {
    expect(format('not-a-cnpj')).toBe('not-a-cnpj');
  });
});

describe('cnpj.mask', () => {
  it('preserves the first 2 and last 2 digits, hiding the middle', () => {
    expect(mask('11222333000181')).toBe('11.***.***/****-81');
  });

  it('accepts already-formatted input', () => {
    expect(mask('11.222.333/0001-81')).toBe('11.***.***/****-81');
  });

  it('returns empty string for empty input', () => {
    expect(mask('')).toBe('');
  });

  it('returns the original input when not 14 digits', () => {
    expect(mask('xyz')).toBe('xyz');
  });
});
