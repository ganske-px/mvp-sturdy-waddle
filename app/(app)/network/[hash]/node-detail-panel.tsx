'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ShortestPath } from '@/lib/graph/path';
import { ArrowRight, Eye, Layers, MapPin, Route, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { GraphEdgeDto, GraphNodeDto } from './actions';
import { ExpandButton } from './expand-button';

type Tab = 'visao' | 'comunidade' | 'caminhos';

const TAB_LABEL: Record<Tab, string> = {
  visao: 'Visão',
  comunidade: 'Comunidade',
  caminhos: 'Caminhos',
};

const TAB_ICON: Record<Tab, typeof Eye> = {
  visao: Eye,
  comunidade: Layers,
  caminhos: Route,
};

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

function VisaoTab({
  node,
  center,
  edges,
}: {
  node: GraphNodeDto;
  center: GraphNodeDto;
  edges: GraphEdgeDto[];
}) {
  const incidentEdges = edges
    .filter((e) => e.source === node.hash || e.target === node.hash)
    .sort((a, b) => (b.evidence.occurrences ?? 1) - (a.evidence.occurrences ?? 1));

  const linkToCenter = incidentEdges.filter(
    (e) =>
      (e.source === node.hash && e.target === center.hash) ||
      (e.target === node.hash && e.source === center.hash),
  );
  const topEvidences = linkToCenter.length > 0 ? linkToCenter : incidentEdges.slice(0, 5);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
          {node.hash === center.hash ? 'Centro da rede' : 'Vínculo com o centro'}
        </p>
        {topEvidences.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Sem vínculo direto. Esse nó aparece em outros vínculos da rede.
          </p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {topEvidences.slice(0, 5).map((e, i) => (
              <li
                key={`${e.kind}-${i}`}
                className="rounded-md border border-border/70 bg-muted/30 px-2 py-1.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {e.kind === 'co_party'
                      ? 'Co-parte'
                      : e.kind === 'client_lawyer'
                        ? 'Representação'
                        : 'Advogado ↔ advogado'}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {e.evidence.occurrences} proc.
                  </span>
                </div>
                {e.evidence.samePolo === true ? (
                  <span className="text-[0.65rem] text-emerald-600">mesmo polo</span>
                ) : null}
                {e.evidence.samePolo === false ? (
                  <span className="text-[0.65rem] text-red-600">polos opostos</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">{incidentEdges.length}</span> conexão(ões) no total
        nesse subgrafo.
      </div>

      {node.type !== 'lawyer' ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <ExpandButton hash={node.hash} inCache={node.inCache} />
          <Link href={`/network/${encodeURIComponent(node.hash)}`}>
            <Button variant="outline" size="sm" className="w-full">
              Ver rede deste nó
            </Button>
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function ComunidadeTab({
  node,
  community,
  membersInSameCommunity,
  onPickNode,
}: {
  node: GraphNodeDto;
  community: number;
  membersInSameCommunity: GraphNodeDto[];
  onPickNode: (hash: string) => void;
}) {
  if (community < 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Esse nó não pertence a uma comunidade densa identificada. Comunidades aparecem quando há
        clusters de vínculos repetidos.
      </p>
    );
  }
  const others = membersInSameCommunity.filter((m) => m.hash !== node.hash);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Faz parte de uma comunidade com{' '}
        <span className="font-mono tabular-nums">{membersInSameCommunity.length}</span> nós.
      </p>
      {others.length === 0 ? (
        <p className="text-xs text-muted-foreground">Único membro visível da comunidade.</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {others.slice(0, 30).map((m) => (
            <li key={m.hash}>
              <button
                type="button"
                onClick={() => onPickNode(m.hash)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
              >
                <span className="truncate">{m.label.name ?? m.maskedPreview}</span>
                <span className="text-[0.65rem] uppercase text-muted-foreground">{m.type}</span>
              </button>
            </li>
          ))}
          {others.length > 30 ? (
            <li className="text-xs text-muted-foreground">… e mais {others.length - 30}</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function CaminhosTab({
  node,
  center,
  pathStart,
  pathStartNode,
  path,
  onSetStart,
  onClearStart,
  pathNodesByHash,
  onPickNode,
}: {
  node: GraphNodeDto;
  center: GraphNodeDto;
  pathStart: string | null;
  pathStartNode: GraphNodeDto | null;
  path: ShortestPath | null;
  onSetStart: (hash: string | null) => void;
  onClearStart: () => void;
  pathNodesByHash: Map<string, GraphNodeDto>;
  onPickNode: (hash: string) => void;
}) {
  if (!pathStart) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Investigue o menor caminho entre dois nós. Selecione a origem aqui e depois clique em
          outro nó pra definir o destino.
        </p>
        <Button variant="outline" size="sm" onClick={() => onSetStart(node.hash)}>
          <MapPin className="size-3.5" />
          Usar este nó como origem
        </Button>
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-2 py-3 text-center text-[0.65rem] uppercase tracking-wider text-muted-foreground">
          Dica: o centro do grafo é normalmente o melhor destino.
        </div>
      </div>
    );
  }

  if (pathStart === node.hash) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-2 py-2 text-xs">
          <div className="flex flex-col">
            <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              Origem definida
            </span>
            <span className="font-medium">{pathStartNode?.label.name ?? node.maskedPreview}</span>
          </div>
          <button
            type="button"
            onClick={onClearStart}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Limpar origem"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Agora clique em outro nó pra definir o destino.
        </p>
      </div>
    );
  }

  // pathStart set AND node is potential destination — show path or "no path"
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-2 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">
            {pathStartNode?.label.name ?? pathStart.slice(0, 10)}
          </span>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{node.label.name ?? node.maskedPreview}</span>
        </div>
        <button
          type="button"
          onClick={onClearStart}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Limpar caminho"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {!path ? (
        <p className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
          Nenhum caminho encontrado entre estes nós com os filtros atuais. Tente reduzir o slider de
          vínculos ou habilitar mais tipos.
        </p>
      ) : (
        <div>
          <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            Caminho de {path.nodes.length} nó(s) — {path.edgeIndices.length} salto(s)
          </p>
          <ol className="mt-2 space-y-1">
            {path.nodes.map((hash, idx) => {
              const n =
                hash === center.hash
                  ? center
                  : (pathNodesByHash.get(hash) ?? {
                      hash,
                      type: 'cpf' as const,
                      label: {},
                      maskedPreview: hash.slice(0, 12),
                      inCache: false,
                      lastSeenAt: '',
                    });
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: path nodes can repeat in degenerate inputs and order is meaningful
                <li key={`${hash}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => onPickNode(hash)}
                    className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                  >
                    <span className="font-mono text-muted-foreground">{idx + 1}</span>
                    <span className="truncate font-medium">{n.label.name ?? n.maskedPreview}</span>
                    <span className="ml-auto text-[0.65rem] uppercase text-muted-foreground">
                      {n.type}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

export function NodeDetailPanel({
  node,
  center,
  edges,
  community,
  membersInSameCommunity,
  pathStart,
  pathStartNode,
  path,
  pathNodesByHash,
  onSetPathStart,
  onClearPathStart,
  onPickNode,
}: {
  node: GraphNodeDto | null;
  center: GraphNodeDto;
  edges: GraphEdgeDto[];
  community: number;
  membersInSameCommunity: GraphNodeDto[];
  pathStart: string | null;
  pathStartNode: GraphNodeDto | null;
  path: ShortestPath | null;
  pathNodesByHash: Map<string, GraphNodeDto>;
  onSetPathStart: (hash: string | null) => void;
  onClearPathStart: () => void;
  onPickNode: (hash: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('visao');

  if (!node) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Selecione um nó</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>Clique em qualquer nó para ver detalhes, evidências e conexões.</p>
          <div className="rounded-md border border-dashed border-border bg-muted/20 px-2 py-2 text-[0.65rem] uppercase tracking-wider">
            Atalhos: clique seleciona · passe o mouse pra destacar · use a aba Caminhos pra
            descobrir como dois nós se conectam.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="truncate">{node.label.name ?? node.maskedPreview}</CardTitle>
        <p className="font-mono text-xs text-muted-foreground">
          {formatDoc(node) ?? node.maskedPreview}
        </p>
        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
          {node.type === 'cpf' ? 'Pessoa' : node.type === 'cnpj' ? 'Empresa' : 'Advogado'}
        </span>
      </CardHeader>
      <div className="flex border-b border-border px-3">
        {(['visao', 'comunidade', 'caminhos'] as const).map((t) => {
          const Icon = TAB_ICON[t];
          const active = tab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition-colors ${
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-3" />
              {TAB_LABEL[t]}
            </button>
          );
        })}
      </div>
      <CardContent className="pt-4">
        {tab === 'visao' ? <VisaoTab node={node} center={center} edges={edges} /> : null}
        {tab === 'comunidade' ? (
          <ComunidadeTab
            node={node}
            community={community}
            membersInSameCommunity={membersInSameCommunity}
            onPickNode={onPickNode}
          />
        ) : null}
        {tab === 'caminhos' ? (
          <CaminhosTab
            node={node}
            center={center}
            pathStart={pathStart}
            pathStartNode={pathStartNode}
            path={path}
            onSetStart={onSetPathStart}
            onClearStart={onClearPathStart}
            pathNodesByHash={pathNodesByHash}
            onPickNode={onPickNode}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
