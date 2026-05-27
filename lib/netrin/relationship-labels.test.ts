import { describe, expect, it } from 'vitest';
import { isFirstDegree, relationshipLabel } from './relationship-labels';

describe('relationshipLabel', () => {
  it('maps known codes to pt-BR labels', () => {
    expect(relationshipLabel('MOTHER')).toBe('Mãe');
    expect(relationshipLabel('SPOUSE')).toBe('Cônjuge');
  });
  it('maps PARTNER to sócio, not companheiro (fonte usa PARTNER para vínculo societário)', () => {
    expect(relationshipLabel('PARTNER')).toBe('Sócio(a)');
  });
  it('falls back to a generic label for unknown or missing codes', () => {
    expect(relationshipLabel('SOMETHING_ELSE')).toBe('Vínculo familiar');
    expect(relationshipLabel(undefined)).toBe('Vínculo familiar');
  });
});

describe('isFirstDegree', () => {
  it('returns true for parents, spouse and children', () => {
    expect(isFirstDegree('MOTHER')).toBe(true);
    expect(isFirstDegree('SPOUSE')).toBe(true);
    expect(isFirstDegree('SON')).toBe(true);
  });
  it('returns false for distant or missing relationships', () => {
    expect(isFirstDegree('COUSIN')).toBe(false);
    expect(isFirstDegree(undefined)).toBe(false);
  });
  it('does not treat PARTNER as family core (é vínculo societário)', () => {
    expect(isFirstDegree('PARTNER')).toBe(false);
  });
});
