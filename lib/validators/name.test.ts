import { describe, expect, it } from 'vitest';
import { maskName } from './name';

describe('maskName', () => {
  it('masks a multi-word name showing first name + first letter of last name', () => {
    expect(maskName('João Silva Souza')).toBe('João S***');
  });

  it('uppercases the surname initial', () => {
    expect(maskName('joão silva')).toBe('joão S***');
  });

  it('returns the name unchanged when only one word is present', () => {
    expect(maskName('Maria')).toBe('Maria');
  });

  it('collapses internal whitespace', () => {
    expect(maskName('  João   Silva  ')).toBe('João S***');
  });

  it('returns empty for empty input', () => {
    expect(maskName('')).toBe('');
    expect(maskName('   ')).toBe('');
  });
});
