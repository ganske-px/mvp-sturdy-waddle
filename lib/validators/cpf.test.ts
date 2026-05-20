import { describe, expect, it } from 'vitest';
import { format, isValid, mask, normalize } from './cpf';

describe('cpf.normalize', () => {
  it('strips non-digit characters', () => {
    expect(normalize('123.456.789-10')).toBe('12345678910');
  });

  it('zero-pads short input to 11 digits', () => {
    expect(normalize('1234567891')).toBe('01234567891');
  });

  it('returns empty string for empty input', () => {
    expect(normalize('')).toBe('');
  });

  it('preserves 11-digit input unchanged', () => {
    expect(normalize('11144477735')).toBe('11144477735');
  });

  it('truncates inputs longer than 11 digits', () => {
    expect(normalize('111444777350')).toBe('');
  });

  it('handles mixed punctuation', () => {
    expect(normalize(' 111 444 777-35 ')).toBe('11144477735');
  });
});

describe('cpf.isValid', () => {
  it('accepts a known-valid CPF', () => {
    expect(isValid('111.444.777-35')).toBe(true);
    expect(isValid('11144477735')).toBe(true);
  });

  it('rejects a CPF with a wrong check digit', () => {
    expect(isValid('111.444.777-36')).toBe(false);
  });

  it('rejects CPFs of all identical digits', () => {
    expect(isValid('111.111.111-11')).toBe(false);
    expect(isValid('000.000.000-00')).toBe(false);
    expect(isValid('99999999999')).toBe(false);
  });

  it('rejects inputs that are not 11 digits long', () => {
    expect(isValid('1234567891')).toBe(false);
    expect(isValid('123456789012')).toBe(false);
    expect(isValid('')).toBe(false);
  });

  it('rejects inputs that are not numeric', () => {
    expect(isValid('abcdefghijk')).toBe(false);
  });

  it('accepts another known-valid CPF', () => {
    expect(isValid('529.982.247-25')).toBe(true);
  });
});

describe('cpf.format', () => {
  it('formats raw digits with the canonical CPF mask', () => {
    expect(format('11144477735')).toBe('111.444.777-35');
  });

  it('passes through already-formatted CPFs after normalization', () => {
    expect(format('111.444.777-35')).toBe('111.444.777-35');
  });

  it('returns empty string for empty input', () => {
    expect(format('')).toBe('');
  });

  it('returns the original input when not 11 digits', () => {
    expect(format('not-a-cpf')).toBe('not-a-cpf');
  });
});

describe('cpf.mask', () => {
  it('preserves the first 3 and last 2 digits, hiding the middle', () => {
    expect(mask('11144477735')).toBe('111.***.***-35');
  });

  it('accepts already-formatted input', () => {
    expect(mask('111.444.777-35')).toBe('111.***.***-35');
  });

  it('returns empty string for empty input', () => {
    expect(mask('')).toBe('');
  });

  it('returns the original input when not 11 digits', () => {
    expect(mask('xyz')).toBe('xyz');
  });
});
