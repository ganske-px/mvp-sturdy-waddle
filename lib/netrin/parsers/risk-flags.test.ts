import { describe, expect, it } from 'vitest';
import { extractCnpjRisk, extractCpfRisk } from './risk-flags';

describe('extractCpfRisk', () => {
  it('flags PEP atual e sanção (atual ou pregressa)', () => {
    expect(
      extractCpfRisk({ pepKyc: { currentlyPEP: 'Sim', currentlySanctioned: false } } as never),
    ).toEqual({
      isPep: true,
      hasSanction: false,
    });
    expect(
      extractCpfRisk({ pepKyc: { currentlyPEP: false, previouslySanctioned: 'S' } } as never),
    ).toEqual({
      isPep: false,
      hasSanction: true,
    });
  });

  it('retorna tudo false quando slug ausente', () => {
    expect(extractCpfRisk({})).toEqual({ isPep: false, hasSanction: false });
  });
});

describe('extractCnpjRisk', () => {
  it('flags sanção por pep-kyc-cnpj, CEIS/CNEP ativos ou trabalho escravo', () => {
    expect(extractCnpjRisk({ 'pep-kyc-cnpj': { sancionado: 'S' } } as never)).toEqual({
      isPep: false,
      hasSanction: true,
    });
    expect(
      extractCnpjRisk({ 'portal-transparencia-ceis': { sancoes: [{ ativo: true }] } } as never),
    ).toEqual({ isPep: false, hasSanction: true });
    expect(extractCnpjRisk({ 'trabalho-escravo': { empregador: [{}] } } as never)).toEqual({
      isPep: false,
      hasSanction: true,
    });
  });

  it('CEIS inativo não conta', () => {
    expect(
      extractCnpjRisk({ 'portal-transparencia-ceis': { sancoes: [{ ativo: false }] } } as never),
    ).toEqual({ isPep: false, hasSanction: false });
  });
});
