'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import type { GraphEdgeDto, GraphNodeDto } from './actions';
import { ExpandButton } from './expand-button';

function formatDoc(node: GraphNodeDto): string | null {
  if (node.type === 'cpf' && node.label.document) {
    return node.label.document.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (node.type === 'cnpj' && node.label.document) {
    return node.label.document.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  if (node.type === 'lawyer' && node.label.oab) {
    return `OAB/${node.label.oab.uf} ${node.label.oab.numero}`;
  }
  return null;
}

export function NodeDetailPanel({
  node,
  center,
  edges,
}: {
  node: GraphNodeDto | null;
  center: GraphNodeDto;
  edges: GraphEdgeDto[];
}) {
  if (!node) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Selecione um nó</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Clique em qualquer nó para ver detalhes e conexões.
        </CardContent>
      </Card>
    );
  }

  const linkingEdges = edges.filter(
    (e) =>
      (e.source === node.hash && e.target === center.hash) ||
      (e.target === node.hash && e.source === center.hash),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{node.label.name ?? node.maskedPreview}</CardTitle>
        <p className="text-xs text-muted-foreground">{formatDoc(node) ?? node.maskedPreview}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {linkingEdges.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Evidências</p>
            <ul className="mt-1 space-y-1">
              {linkingEdges.map((e, i) => (
                <li key={`${e.kind}-${i}`} className="text-xs">
                  <span className="font-medium">{e.kind}</span>
                  {' · '}
                  {e.evidence.occurrences} processo(s)
                  {e.evidence.samePolo === true ? ' · mesmo polo' : null}
                  {e.evidence.samePolo === false ? ' · polos opostos' : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {node.type !== 'lawyer' ? (
          <>
            <ExpandButton hash={node.hash} inCache={node.inCache} />
            <Link href={`/network/${encodeURIComponent(node.hash)}`}>
              <Button variant="outline" size="sm" className="w-full">
                Ver rede deste nó
              </Button>
            </Link>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
