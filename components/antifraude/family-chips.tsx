'use client';

import { deepenDocument } from '@/app/(app)/search/deepen/actions';
import { relationshipLabel } from '@/lib/netrin/relationship-labels';
import { useTransition } from 'react';
import type { RelatedPersonEntry } from './types';

export type FamilyChipsProps = {
  /** Já filtrado para 1º grau pelo chamador. */
  people: RelatedPersonEntry[];
  parentCpfHash: string;
  currentPath?: string;
};

export function FamilyChips({ people, parentCpfHash, currentPath }: FamilyChipsProps) {
  const [isPending, startTransition] = useTransition();
  if (people.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Núcleo familiar
      </span>
      {people.map((p, i) => (
        <button
          key={`${p.cpfHash}-${i}`}
          type="button"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              await deepenDocument({
                docType: 'cpf-relacionado',
                cpfHash: p.cpfHash,
                parentCpfHash,
                currentPath,
              });
            });
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-3 py-1 text-xs transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
          title={`${relationshipLabel(p.tipoRelacionamento)} · ${p.maskedPreview}`}
        >
          <span className="font-medium">{p.nome ?? 'Sem nome'}</span>
          <span className="text-muted-foreground">{relationshipLabel(p.tipoRelacionamento)}</span>
        </button>
      ))}
    </div>
  );
}
