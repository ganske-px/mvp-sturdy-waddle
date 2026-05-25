'use client';

import { Building2, Scale, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { NodeType } from '@/lib/graph/types';
import type { GraphEdgeDto, GraphNodeDto, SubgraphDto } from './actions';
import { NodeDetailPanel } from './node-detail-panel';

type NodeData = { dto: GraphNodeDto; isCenter: boolean };

function CpfNode({ data }: NodeProps<NodeData>) {
  return (
    <div
      className={`flex max-w-[180px] items-center gap-2 rounded-full border bg-primary/15 px-3 py-2 text-xs ${data.isCenter ? 'border-primary ring-2 ring-primary' : 'border-primary/60'}`}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <User className="size-3.5 shrink-0 text-primary" />
      <span className="truncate font-medium">{data.dto.label.name ?? data.dto.maskedPreview}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

function CnpjNode({ data }: NodeProps<NodeData>) {
  return (
    <div
      className={`flex max-w-[180px] items-center gap-2 rounded-md border bg-accent/15 px-3 py-2 text-xs ${data.isCenter ? 'border-accent ring-2 ring-accent' : 'border-accent/60'}`}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Building2 className="size-3.5 shrink-0 text-accent-foreground" />
      <span className="truncate font-medium">{data.dto.label.name ?? data.dto.maskedPreview}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

function LawyerNode({ data }: NodeProps<NodeData>) {
  return (
    <div className="flex max-w-[180px] items-center gap-2 rounded-sm border bg-muted px-3 py-2 text-xs">
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Scale className="size-3.5 shrink-0" />
      <span className="truncate font-medium">{data.dto.label.name ?? 'Advogado'}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

const NODE_TYPES = { cpf: CpfNode, cnpj: CnpjNode, lawyer: LawyerNode };

const TYPE_ORDER: readonly NodeType[] = ['cpf', 'cnpj', 'lawyer'];
const TYPE_LABELS: Record<NodeType, string> = {
  cpf: 'Pessoas',
  cnpj: 'Empresas',
  lawyer: 'Advogados',
};
const TYPE_ICON: Record<NodeType, typeof User> = {
  cpf: User,
  cnpj: Building2,
  lawyer: Scale,
};

function edgeStyle(edge: GraphEdgeDto): { stroke: string; strokeDasharray?: string } {
  if (edge.kind === 'client_lawyer') return { stroke: '#999', strokeDasharray: '4 4' };
  if (edge.kind === 'lawyer_lawyer') return { stroke: '#999', strokeDasharray: '2 4' };
  if (edge.evidence.samePolo === true) return { stroke: '#22c55e' };
  if (edge.evidence.samePolo === false) return { stroke: '#ef4444' };
  return { stroke: '#71717a' };
}

// Concentric multi-ring layout grouped by node type. With dense subgraphs
// (hundreds of neighbours) a single circle overlaps every label; this packs
// each type onto its own band of rings, sized so node centres stay >= MIN_GAP
// apart. ReactFlow's fitView zooms to span them all.
const RING_BASE = 260;
const RING_STEP = 240;
const MIN_GAP = 80;

function layout(center: GraphNodeDto, neighbors: GraphNodeDto[]): Node<NodeData>[] {
  const centerNode: Node<NodeData> = {
    id: center.hash,
    type: center.type,
    position: { x: 0, y: 0 },
    data: { dto: center, isCenter: true },
  };

  const grouped: Record<NodeType, GraphNodeDto[]> = { cpf: [], cnpj: [], lawyer: [] };
  for (const n of neighbors) grouped[n.type].push(n);

  const placed: Node<NodeData>[] = [centerNode];
  let ringIndex = 1;
  for (const type of TYPE_ORDER) {
    const items = grouped[type];
    if (items.length === 0) continue;
    let cursor = 0;
    while (cursor < items.length) {
      const r = RING_BASE + RING_STEP * (ringIndex - 1);
      const capacity = Math.max(8, Math.floor((2 * Math.PI * r) / MIN_GAP));
      const take = Math.min(items.length - cursor, capacity);
      const startAngle = ((ringIndex * 0.37) % 1) * 2 * Math.PI;
      for (let i = 0; i < take; i++) {
        const angle = startAngle + (i / take) * 2 * Math.PI;
        const item = items[cursor + i];
        if (!item) continue;
        placed.push({
          id: item.hash,
          type: item.type,
          position: { x: r * Math.cos(angle), y: r * Math.sin(angle) },
          data: { dto: item, isCenter: false },
        });
      }
      cursor += take;
      ringIndex++;
    }
  }
  return placed;
}

export function NetworkCanvas({ subgraph }: { subgraph: SubgraphDto }) {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set());

  const counts = useMemo(() => {
    const result: Record<NodeType, number> = { cpf: 0, cnpj: 0, lawyer: 0 };
    for (const n of subgraph.neighbors) result[n.type]++;
    return result;
  }, [subgraph.neighbors]);

  const visibleNeighbors = useMemo(
    () => subgraph.neighbors.filter((n) => !hiddenTypes.has(n.type)),
    [subgraph.neighbors, hiddenTypes],
  );

  const nodes = useMemo(() => {
    if (!subgraph.center) return [];
    return layout(subgraph.center, visibleNeighbors);
  }, [subgraph.center, visibleNeighbors]);

  const visibleHashSet = useMemo(() => {
    const s = new Set<string>();
    if (subgraph.center) s.add(subgraph.center.hash);
    for (const n of visibleNeighbors) s.add(n.hash);
    return s;
  }, [subgraph.center, visibleNeighbors]);

  const edges = useMemo<Edge[]>(
    () =>
      subgraph.edges
        .filter((e) => visibleHashSet.has(e.source) && visibleHashSet.has(e.target))
        .map((e, i) => {
          const style = edgeStyle(e);
          const widthBase = Math.min(4, 1 + e.evidence.occurrences * 0.5);
          return {
            id: `e-${i}`,
            source: e.source,
            target: e.target,
            style: { ...style, strokeWidth: widthBase },
          };
        }),
    [subgraph.edges, visibleHashSet],
  );

  const selected =
    selectedHash === null
      ? null
      : subgraph.center?.hash === selectedHash
        ? subgraph.center
        : (subgraph.neighbors.find((n) => n.hash === selectedHash) ?? null);

  function toggleType(t: NodeType) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  if (!subgraph.center) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
        <p className="text-sm font-medium">Este nó ainda não tem rede mapeada</p>
        <p className="max-w-md text-xs text-muted-foreground">
          A rede é construída a partir das partes e advogados que aparecem nos processos retornados
          pela consulta. Faça uma busca pelo documento (ou aguarde uma busca que o mencione como
          co-parte) para que ele apareça aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">{subgraph.neighbors.length} vizinhos</span>
        {TYPE_ORDER.map((t) => {
          const Icon = TYPE_ICON[t];
          const hidden = hiddenTypes.has(t);
          const count = counts[t];
          if (count === 0) return null;
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
                hidden
                  ? 'border-border bg-transparent text-muted-foreground line-through'
                  : 'border-foreground/20 bg-foreground/5 text-foreground'
              }`}
            >
              <Icon className="size-3" />
              {TYPE_LABELS[t]} ({count})
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="h-[78vh] min-h-[600px] overflow-hidden rounded-xl border border-border bg-card">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_, n) => setSelectedHash(n.id)}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.05}
          >
            <Background gap={24} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        <NodeDetailPanel node={selected} center={subgraph.center} edges={subgraph.edges} />
      </div>
    </div>
  );
}
