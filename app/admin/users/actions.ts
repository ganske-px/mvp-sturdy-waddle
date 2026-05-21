'use server';

import type { Service } from '@/lib/auth/permissions';

export type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

// Placeholder: real implementation lands in T18.
export async function setUserActive(_userId: string, _active: boolean): Promise<ActionResult> {
  return { ok: false, error: 'Not yet implemented.' };
}
// More actions land in T18.
export type { Service };
