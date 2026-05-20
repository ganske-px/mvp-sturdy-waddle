/**
 * Returns a partially-masked version of a name suitable for the UI:
 *   "João Silva Souza" → "João S***"
 *   "Maria"            → "Maria"
 *
 * Used to show operators what they searched without persisting the full PII.
 */
export function maskName(input: string): string {
  if (!input) return '';
  const trimmed = input.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const parts = trimmed.split(' ');
  if (parts.length === 1) return parts[0] as string;
  const first = parts[0] as string;
  const second = parts[1] as string;
  return `${first} ${(second[0] ?? '').toUpperCase()}***`;
}
