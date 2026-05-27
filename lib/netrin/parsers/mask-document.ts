// lib/netrin/parsers/mask-document.ts
import { mask as maskCnpj } from '@/lib/validators/cnpj';
import { mask as maskCpf } from '@/lib/validators/cpf';

/**
 * LGPD: any CPF/CNPJ that crosses the server→client boundary inside a detail
 * record must be masked. Returns the masked form for 11-digit (CPF) or
 * 14-digit (CNPJ) values, or `undefined` for anything that is not a document
 * (so we never leak an unrecognized identifier in cleartext).
 */
export function maskDocument(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) return maskCpf(digits);
  if (digits.length === 14) return maskCnpj(digits);
  return undefined;
}
