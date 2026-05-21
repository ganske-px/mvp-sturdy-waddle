'use client';

import type { SubgraphDto } from './actions';

export function NetworkCanvas({ subgraph }: { subgraph: SubgraphDto }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
      Canvas em construção. {subgraph.neighbors.length} vizinhos carregados.
    </div>
  );
}
