import { describe, expect, it } from 'vitest';
import { detect } from './detect';

describe('detect', () => {
  it('returns empty for blank input', () => {
    expect(detect('')).toEqual({ kind: 'empty' });
    expect(detect('   ')).toEqual({ kind: 'empty' });
  });

  it('detects valid CPF with formatting', () => {
    const result = detect('111.444.777-35');
    expect(result).toEqual({ kind: 'ready', type: 'cpf', normalized: '11144477735' });
  });

  it('detects valid CPF without formatting', () => {
    expect(detect('11144477735')).toEqual({
      kind: 'ready',
      type: 'cpf',
      normalized: '11144477735',
    });
  });

  it('flags invalid CPF check digits', () => {
    expect(detect('12345678900')).toEqual({
      kind: 'invalid',
      type: 'cpf',
      error: 'CPF inválido.',
    });
  });

  it('detects valid CNPJ with formatting', () => {
    const result = detect('11.222.333/0001-81');
    expect(result).toEqual({ kind: 'ready', type: 'cnpj', normalized: '11222333000181' });
  });

  it('flags invalid CNPJ check digits', () => {
    expect(detect('12345678000100')).toEqual({
      kind: 'invalid',
      type: 'cnpj',
      error: 'CNPJ inválido.',
    });
  });

  it('pending: short digit string', () => {
    const r = detect('123');
    expect(r.kind).toBe('pending');
  });

  it('pending: between CPF and CNPJ lengths', () => {
    const r = detect('123456789012');
    expect(r.kind).toBe('pending');
  });

  it('detects name when any letter present', () => {
    expect(detect('Maria Silva')).toEqual({
      kind: 'ready',
      type: 'name',
      normalized: 'Maria Silva',
    });
  });

  it('name with accents counts', () => {
    expect(detect('João')).toEqual({ kind: 'ready', type: 'name', normalized: 'João' });
  });

  it('name with mixed digits is still a name', () => {
    expect(detect('Maria 123')).toEqual({
      kind: 'ready',
      type: 'name',
      normalized: 'Maria 123',
    });
  });

  it('pending: too short for name', () => {
    expect(detect('Jo').kind).toBe('pending');
  });

  it('rejects digit string longer than CNPJ', () => {
    expect(detect('123456789012345').kind).toBe('invalid');
  });
});
