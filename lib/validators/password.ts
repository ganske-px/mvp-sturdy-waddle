const MIN_LENGTH = 12;
const DEFAULT_LENGTH = 16;

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*-_=+';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateTempPassword(value: string): ValidationResult {
  if (value.length < MIN_LENGTH) {
    return {
      ok: false,
      error: `A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`,
    };
  }
  return { ok: true };
}

export function generateStrongPassword(length: number = DEFAULT_LENGTH): string {
  if (length < MIN_LENGTH) {
    throw new Error(`Password length must be at least ${MIN_LENGTH}.`);
  }
  const required = [pickRandom(LOWER), pickRandom(UPPER), pickRandom(DIGITS), pickRandom(SYMBOLS)];
  const remaining = Array.from({ length: length - required.length }, () => pickRandom(ALL));
  const chars = shuffle([...required, ...remaining]);
  return chars.join('');
}

function pickRandom(pool: string): string {
  const idx = Math.floor(secureRandom() * pool.length);
  return pool[idx] ?? '';
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(secureRandom() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function secureRandom(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] ?? 0) / 0x1_0000_0000;
  }
  return Math.random();
}
