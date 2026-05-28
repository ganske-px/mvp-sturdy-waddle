import { describe, expect, it } from 'vitest';
import { planNodeInvestigation } from './investigate-plan';

describe('planNodeInvestigation', () => {
  it('planeja busca de CPF a partir de documento de 11 dígitos', () => {
    expect(planNodeInvestigation({ type: 'cpf', document: '12345678909' })).toEqual({
      ok: true,
      type: 'cpf',
      document: '12345678909',
    });
  });

  it('planeja busca de CNPJ e remove a formatação', () => {
    expect(planNodeInvestigation({ type: 'cnpj', document: '12.345.678/0001-90' })).toEqual({
      ok: true,
      type: 'cnpj',
      document: '12345678000190',
    });
  });

  it('rejeita nós de advogado', () => {
    expect(planNodeInvestigation({ type: 'lawyer' })).toEqual({
      ok: false,
      error: 'Advogados não podem ser investigados por documento.',
    });
  });

  it('rejeita nó sem documento ou com documento malformado', () => {
    const erro = { ok: false, error: 'Não foi possível recuperar o documento deste nó.' };
    expect(planNodeInvestigation({ type: 'cpf' })).toEqual(erro);
    expect(planNodeInvestigation({ type: 'cnpj', document: '123' })).toEqual(erro);
  });
});
