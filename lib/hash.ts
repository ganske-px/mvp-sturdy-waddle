import { createHash } from 'node:crypto';
import { normalize as normalizeCnpj } from '@/lib/validators/cnpj';
import { normalize as normalizeCpf } from '@/lib/validators/cpf';

export type HashDocumentType = 'cpf' | 'cnpj' | 'name';

export function normalizeNameForHash(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalizeForType(type: HashDocumentType, value: string): string {
  switch (type) {
    case 'cpf': {
      const normalized = normalizeCpf(value);
      if (normalized.length !== 11) {
        throw new Error('Cannot hash CPF: input does not normalize to 11 digits.');
      }
      return normalized;
    }
    case 'cnpj': {
      const normalized = normalizeCnpj(value);
      if (normalized.length !== 14) {
        throw new Error('Cannot hash CNPJ: input does not normalize to 14 digits.');
      }
      return normalized;
    }
    case 'name': {
      const normalized = normalizeNameForHash(value);
      if (!normalized) {
        throw new Error('Cannot hash name: input normalizes to empty.');
      }
      return normalized;
    }
  }
}

export function hashDocument(type: HashDocumentType, value: string): string {
  if (!value) {
    throw new Error(`Cannot hash ${type}: empty input.`);
  }
  const normalized = normalizeForType(type, value);
  // Prefix with the type so the same string under different types yields
  // different hashes. Belt-and-suspenders on top of the column constraint.
  return createHash('sha256').update(`${type}:${normalized}`).digest('hex');
}
