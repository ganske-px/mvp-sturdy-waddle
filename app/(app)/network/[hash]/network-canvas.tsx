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
import type { GraphEdgeDto, GraphNodeDto, SubgraphDto } from './actions';
import { NodeDetailPanel } from './node-detail-panel';

type NodeData = { dto: GraphNodeDto; isCenter: boolean };

function CpfNode({ data }: NodeProps<NodeData>) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border bg-primary/15 px-3 py-2 text-xs ${data.isCenter ? 'border-primary ring-2 ring-primary' : 'border-primary/60'}`}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <User className="size-3.5 text-primary" />
      <span className="font-medium">{data.dto.label.name ?? data.dto.maskedPreview}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

function CnpjNode({ data }: NodeProps<NodeData>) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md border bg-accent/15 px-3 py-2 text-xs ${data.isCenter ? 'border-accent ring-2 ring-accent' : 'border-accent/60'}`}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Building2 className="size-3.5 text-accent-foreground" />
      <span className="font-medium">{data.dto.label.name ?? data.dto.maskedPreview}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

function LawyerNode({ data }: NodeProps<NodeData>) {
  return (
    <div className="flex items-center gap-2 rounded-sm border bg-muted px-3 py-2 text-xs">
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Scale className="size-3.5" />
      <span className="font-medium">{data.dto.label.name ?? 'Advogado'}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

const NODE_TYPES = { cpf: CpfNode, cnpj: CnpjNode, lawyer: LawyerNode };

function edgeStyle(edge: GraphEdgeDto): { stroke: string; strokeDasharray?: string } {
  if (edge.kind === 'client_lawyer') return { stroke: '#999', strokeDasharray: '4 4' };
  if (edge.kind === 'lawyer_lawyer') return { stroke: '#999', strokeDasharray: '2 4' };
  if (edge.evidence.samePolo === true) return { stroke: '#22c55e' };
  if (edge.evidence.samePolo === false) return { stroke: '#ef4444' };
  return { stroke: '#71717a' };
}

function layout(center: GraphNodeDto, neighbors: GraphNodeDto[]): Node<NodeData>[] {
  const cx = 0;
  const cy = 0;
  const radius = 220;
  const centerNode: Node<NodeData> = {
    id: center.hash,
    type: center.type,
    position: { x: cx, y: cy },
    data: { dto: center, isCenter: true },
  };
  const ring = neighbors.map((n, i) => {
    const angle = (i / Math.max(1, neighbors.length)) * Math.PI * 2;
    return {
      id: n.hash,
      type: n.type,
      position: { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius },
      data: { dto: n, isCenter: false },
    } satisfies Node<NodeData>;
  });
  return [centerNode, ...ring];
}

export function NetworkCanvas({ subgraph }: { subgraph: SubgraphDto }) {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  const nodes = useMemo(() => {
    if (!subgraph.center) return [];
    return layout(subgraph.center, subgraph.neighbors);
  }, [subgraph]);

  const edges = useMemo<Edge[]>(
    () =>
      subgraph.edges.map((e, i) => {
        const style = edgeStyle(e);
        const widthBase = Math.min(4, 1 + e.evidence.occurrences * 0.5);
        return {
          id: `e-${i}`,
          source: e.source,
          target: e.target,
          style: { ...style, strokeWidth: widthBase },
        };
      }),
    [subgraph.edges],
  );

  const selected =
    selectedHash === null
      ? null
      : subgraph.center?.hash === selectedHash
        ? subgraph.center
        : (subgraph.neighbors.find((n) => n.hash === selectedHash) ?? null);

  if (!subgraph.center) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
        Este nó ainda não tem conexões mapeadas.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_320px]">
      <div className="h-[600px] rounded-xl border border-border bg-card">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, n) => setSelectedHash(n.id)}
          fitView
        >
          <Background gap={24} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <NodeDetailPanel node={selected} center={subgraph.center} edges={subgraph.edges} />
    </div>
  );
}
