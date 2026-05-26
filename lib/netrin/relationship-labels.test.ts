import { describe, expect, it } from 'vitest';
import { isFirstDegree, relationshipLabel } from './relationship-labels';

describe('relationshipLabel', () => {
  it('maps known codes to pt-BR labels', () => {
    expect(relationshipLabel('MOTHER')).toBe('Mãe');
    expect(relationshipLabel('SPOUSE')).toBe('Cônjuge');
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
});
