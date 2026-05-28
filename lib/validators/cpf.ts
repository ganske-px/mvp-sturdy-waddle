const CPF_LENGTH = 11;

function stripNonDigits(input: string): string {
  return input.replace(/\D/g, '');
}

function calcCheckDigit(digits: string, sliceLength: number): number {
  let sum = 0;
  for (let i = 0; i < sliceLength; i++) {
    sum += Number(digits[i]) * (sliceLength + 1 - i);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function normalize(input: string): string {
  if (!input) return '';
  const digits = stripNonDigits(input);
  if (digits.length > CPF_LENGTH) return '';
  return digits.padStart(CPF_LENGTH, '0');
}

export function isValid(input: string): boolean {
  if (!input) return false;
  const digits = stripNonDigits(input);
  if (digits.length !== CPF_LENGTH) return false;
  if (/^(\d)\1+$/.test(digits)) return false;

  const d1 = calcCheckDigit(digits, 9);
  const d2 = calcCheckDigit(digits, 10);
  return d1 === Number(digits[9]) && d2 === Number(digits[10]);
}

export function format(input: string): string {
  if (!input) return '';
  const digits = stripNonDigits(input);
  if (digits.length !== CPF_LENGTH) return input;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function mask(input: string): string {
  if (!input) return '';
  const digits = stripNonDigits(input);
  if (digits.length !== CPF_LENGTH) return input;
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
}
