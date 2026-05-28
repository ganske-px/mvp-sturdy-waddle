const CNPJ_LENGTH = 14;

// Weights for first check digit (12 prefix digits): 5,4,3,2,9,8,7,6,5,4,3,2
// Weights for second check digit (13 prefix digits): 6,5,4,3,2,9,8,7,6,5,4,3,2
const WEIGHTS_FIRST = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const WEIGHTS_SECOND = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function stripNonDigits(input: string): string {
  return input.replace(/\D/g, '');
}

function calcCheckDigit(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += Number(digits[i]) * (weights[i] as number);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function normalize(input: string): string {
  if (!input) return '';
  const digits = stripNonDigits(input);
  if (digits.length > CNPJ_LENGTH) return '';
  return digits.padStart(CNPJ_LENGTH, '0');
}

export function isValid(input: string): boolean {
  if (!input) return false;
  const digits = stripNonDigits(input);
  if (digits.length !== CNPJ_LENGTH) return false;
  if (/^(\d)\1+$/.test(digits)) return false;

  const d1 = calcCheckDigit(digits, WEIGHTS_FIRST);
  const d2 = calcCheckDigit(digits, WEIGHTS_SECOND);
  return d1 === Number(digits[12]) && d2 === Number(digits[13]);
}

export function format(input: string): string {
  if (!input) return '';
  const digits = stripNonDigits(input);
  if (digits.length !== CNPJ_LENGTH) return input;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function mask(input: string): string {
  if (!input) return '';
  const digits = stripNonDigits(input);
  if (digits.length !== CNPJ_LENGTH) return input;
  return `${digits.slice(0, 2)}.***.***/****-${digits.slice(12)}`;
}
