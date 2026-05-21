import { isValid as isCnpjValid } from '@/lib/validators/cnpj';
import { isValid as isCpfValid } from '@/lib/validators/cpf';

const CPF_LENGTH = 11;
const CNPJ_LENGTH = 14;
const MIN_NAME_LENGTH = 3;

export type DetectionState =
  | { kind: 'empty' }
  | { kind: 'pending'; hint: string }
  | { kind: 'ready'; type: 'cpf' | 'cnpj' | 'name'; normalized: string }
  | { kind: 'invalid'; type: 'cpf' | 'cnpj' | 'name'; error: string };

function hasAnyLetter(s: string): boolean {
  return /\p{L}/u.test(s);
}

function stripFormatting(s: string): string {
  return s.replace(/[\s.\-/]/g, '');
}

export function detect(raw: string): DetectionState {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'empty' };

  if (hasAnyLetter(trimmed)) {
    if (trimmed.length < MIN_NAME_LENGTH) {
      return {
        kind: 'pending',
        hint: `Continue digitando — pelo menos ${MIN_NAME_LENGTH} caracteres para nome.`,
      };
    }
    return { kind: 'ready', type: 'name', normalized: trimmed };
  }

  const clean = stripFormatting(trimmed);
  if (!/^\d+$/.test(clean)) {
    return {
      kind: 'invalid',
      type: 'name',
      error: 'Use apenas dígitos para CPF ou CNPJ, ou letras para nome.',
    };
  }

  if (clean.length < CPF_LENGTH) {
    return {
      kind: 'pending',
      hint: `Continue digitando — ${CPF_LENGTH - clean.length} para CPF ou ${CNPJ_LENGTH - clean.length} para CNPJ.`,
    };
  }

  if (clean.length === CPF_LENGTH) {
    if (isCpfValid(clean)) return { kind: 'ready', type: 'cpf', normalized: clean };
    return { kind: 'invalid', type: 'cpf', error: 'CPF inválido.' };
  }

  if (clean.length < CNPJ_LENGTH) {
    return {
      kind: 'pending',
      hint: `Continue digitando — faltam ${CNPJ_LENGTH - clean.length} dígitos para CNPJ.`,
    };
  }

  if (clean.length === CNPJ_LENGTH) {
    if (isCnpjValid(clean)) return { kind: 'ready', type: 'cnpj', normalized: clean };
    return { kind: 'invalid', type: 'cnpj', error: 'CNPJ inválido.' };
  }

  return { kind: 'invalid', type: 'cnpj', error: 'Documento muito longo.' };
}
