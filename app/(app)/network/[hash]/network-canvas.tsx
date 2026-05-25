'use client';

import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { Building2, Filter, Scale, User } from 'lucide-react';
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

type NodeData = {
  dto: GraphNodeDto;
  isCenter: boolean;
  isHub: boolean;
  community: number;
};

// Stable palette for community accent rings. Cycles if there are more
// communities than colours — a noisy outcome but not incorrect.
const COMMUNITY_COLORS = [
  '#0ea5e9', // sky
  '#f97316', // orange
  '#a855f7', // purple
  '#eab308', // yellow
  '#10b981', // emerald
  '#ec4899', // pink
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#f43f5e', // rose
  '#84cc16', // lime
];

function communityColor(id: number): string {
  if (id < 0) return '#71717a';
  return COMMUNITY_COLORS[id % COMMUNITY_COLORS.length] ?? '#71717a';
}

function NodeShell({
  data,
  baseClass,
  Icon,
}: {
  data: NodeData;
  baseClass: string;
  Icon: typeof User;
}) {
  const ringStyle = data.isHub
    ? { boxShadow: `0 0 0 3px ${communityColor(data.community)}` }
    : data.community >= 0
      ? { boxShadow: `0 0 0 1.5px ${communityColor(data.community)}` }
      : undefined;
  return (
    <div className={baseClass} style={ringStyle}>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate font-medium">{data.dto.label.name ?? data.dto.maskedPreview}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

function CpfNode({ data }: NodeProps<NodeData>) {
  return (
    <NodeShell
      data={data}
      Icon={User}
      baseClass={`flex max-w-[200px] items-center gap-2 rounded-full border bg-primary/15 px-3 py-2 text-xs ${data.isCenter ? 'border-primary ring-2 ring-primary' : 'border-primary/60'}`}
    />
  );
}

function CnpjNode({ data }: NodeProps<NodeData>) {
  return (
    <NodeShell
      data={data}
      Icon={Building2}
      baseClass={`flex max-w-[200px] items-center gap-2 rounded-md border bg-accent/15 px-3 py-2 text-xs ${data.isCenter ? 'border-accent ring-2 ring-accent' : 'border-accent/60'}`}
    />
  );
}

function LawyerNode({ data }: NodeProps<NodeData>) {
  return (
    <NodeShell
      data={data}
      Icon={Scale}
      baseClass="flex max-w-[200px] items-center gap-2 rounded-sm border border-border bg-muted px-3 py-2 text-xs"
    />
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

type EdgeStyleKind =
  | 'co_party_same'
  | 'co_party_opposed'
  | 'co_party_unknown'
  | 'client_lawyer'
  | 'lawyer_lawyer';

const EDGE_STYLES: Record<
  EdgeStyleKind,
  { stroke: string; strokeDasharray?: string; label: string }
> = {
  co_party_same: { stroke: '#22c55e', label: 'Mesmo polo' },
  co_party_opposed: { stroke: '#ef4444', label: 'Polos opostos' },
  co_party_unknown: { stroke: '#71717a', label: 'Co-parte (polo n/d)' },
  client_lawyer: { stroke: '#3b82f6', strokeDasharray: '6 4', label: 'Representação' },
  lawyer_lawyer: { stroke: '#a855f7', strokeDasharray: '2 4', label: 'Advogado ↔ advogado' },
};

function classifyEdge(edge: GraphEdgeDto): EdgeStyleKind {
  if (edge.kind === 'client_lawyer') return 'client_lawyer';
  if (edge.kind === 'lawyer_lawyer') return 'lawyer_lawyer';
  if (edge.evidence.samePolo === true) return 'co_party_same';
  if (edge.evidence.samePolo === false) return 'co_party_opposed';
  return 'co_party_unknown';
}

const TOP_HUBS = 5;

// Builds a graphology graph, runs Louvain for community assignment, then
// ForceAtlas2 for positions. Computed once per subgraph; filters never
// re-run this so positions stay stable as the operator toggles chips.
function computeLayout(subgraph: SubgraphDto): {
  positions: Map<string, { x: number; y: number }>;
  communityById: Map<string, number>;
  hubSet: Set<string>;
  maxOccurrences: number;
} {
  const positions = new Map<string, { x: number; y: number }>();
  const communityById = new Map<string, number>();
  const hubSet = new Set<string>();
  if (!subgraph.center) return { positions, communityById, hubSet, maxOccurrences: 1 };

  const g = new Graph({ multi: false, type: 'undirected' });
  g.addNode(subgraph.center.hash);
  for (const n of subgraph.neighbors) {
    if (!g.hasNode(n.hash)) g.addNode(n.hash);
  }

  let maxOccurrences = 1;
  for (const e of subgraph.edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    if (e.source === e.target) continue;
    const weight = Math.max(1, e.evidence.occurrences ?? 1);
    if (weight > maxOccurrences) maxOccurrences = weight;
    if (g.hasEdge(e.source, e.target)) {
      const cur = g.getEdgeAttribute(e.source, e.target, 'weight') ?? 1;
      g.setEdgeAttribute(e.source, e.target, 'weight', Math.max(cur, weight));
    } else {
      g.addEdge(e.source, e.target, { weight });
    }
  }

  // Initial layout — small random scatter to seed FA2. Keeps the center near
  // the origin so the eventual fitView lands roughly centered.
  for (const node of g.nodes()) {
    if (node === subgraph.center.hash) {
      g.setNodeAttribute(node, 'x', 0);
      g.setNodeAttribute(node, 'y', 0);
    } else {
      g.setNodeAttribute(node, 'x', (Math.random() - 0.5) * 100);
      g.setNodeAttribute(node, 'y', (Math.random() - 0.5) * 100);
    }
  }

  try {
    louvain.assign(g, { getEdgeWeight: 'weight' });
    for (const node of g.nodes()) {
      const c = g.getNodeAttribute(node, 'community') as number | undefined;
      if (typeof c === 'number') communityById.set(node, c);
    }
  } catch {
    // Louvain can throw on degenerate graphs; carry on without communities.
  }

  try {
    forceAtlas2.assign(g, {
      iterations: 200,
      settings: {
        gravity: 1,
        scalingRatio: 10,
        strongGravityMode: false,
        barnesHutOptimize: true,
        barnesHutTheta: 0.5,
        slowDown: 5,
        linLogMode: false,
        outboundAttractionDistribution: false,
        adjustSizes: false,
        edgeWeightInfluence: 1,
      },
    });
  } catch {
    // Fall back to the seeded random scatter.
  }

  // Translate so the centre node sits at (0, 0) — keeps the visual focus on
  // the searched entity, matters when the user pans/zooms.
  const cx = (g.getNodeAttribute(subgraph.center.hash, 'x') as number) ?? 0;
  const cy = (g.getNodeAttribute(subgraph.center.hash, 'y') as number) ?? 0;
  for (const node of g.nodes()) {
    positions.set(node, {
      x: ((g.getNodeAttribute(node, 'x') as number) ?? 0) - cx,
      y: ((g.getNodeAttribute(node, 'y') as number) ?? 0) - cy,
    });
  }

  const weightedDegree = new Map<string, number>();
  for (const node of g.nodes()) {
    let total = 0;
    g.forEachEdge(node, (_e, attrs) => {
      total += (attrs.weight as number) ?? 1;
    });
    weightedDegree.set(node, total);
  }
  const ranked = [...weightedDegree.entries()]
    .filter(([h]) => h !== subgraph.center?.hash)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_HUBS);
  for (const [h] of ranked) hubSet.add(h);

  return { positions, communityById, hubSet, maxOccurrences };
}

export function NetworkCanvas({ subgraph }: { subgraph: SubgraphDto }) {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set());
  const [minOccurrences, setMinOccurrences] = useState(1);

  const { positions, communityById, hubSet, maxOccurrences } = useMemo(
    () => computeLayout(subgraph),
    [subgraph],
  );

  const counts = useMemo(() => {
    const result: Record<NodeType, number> = { cpf: 0, cnpj: 0, lawyer: 0 };
    for (const n of subgraph.neighbors) result[n.type]++;
    return result;
  }, [subgraph.neighbors]);

  const filteredEdges = useMemo(
    () => subgraph.edges.filter((e) => (e.evidence.occurrences ?? 1) >= minOccurrences),
    [subgraph.edges, minOccurrences],
  );

  const visibleNeighbors = useMemo(
    () => subgraph.neighbors.filter((n) => !hiddenTypes.has(n.type)),
    [subgraph.neighbors, hiddenTypes],
  );

  const visibleHashSet = useMemo(() => {
    const s = new Set<string>();
    if (subgraph.center) s.add(subgraph.center.hash);
    for (const n of visibleNeighbors) s.add(n.hash);
    return s;
  }, [subgraph.center, visibleNeighbors]);

  const finalEdges = useMemo<Edge[]>(
    () =>
      filteredEdges
        .filter((e) => visibleHashSet.has(e.source) && visibleHashSet.has(e.target))
        .map((e, i) => {
          const kind = classifyEdge(e);
          const style = EDGE_STYLES[kind];
          const widthBase = Math.min(5, 1 + (e.evidence.occurrences ?? 1) * 0.4);
          return {
            id: `e-${i}`,
            source: e.source,
            target: e.target,
            style: {
              stroke: style.stroke,
              strokeDasharray: style.strokeDasharray,
              strokeWidth: widthBase,
              opacity: 0.85,
            },
          };
        }),
    [filteredEdges, visibleHashSet],
  );

  const finalNodes = useMemo<Node<NodeData>[]>(() => {
    if (!subgraph.center) return [];
    const pool: GraphNodeDto[] = [subgraph.center, ...visibleNeighbors];
    return pool.map((n) => {
      const pos = positions.get(n.hash) ?? { x: 0, y: 0 };
      return {
        id: n.hash,
        type: n.type,
        position: pos,
        data: {
          dto: n,
          isCenter: n.hash === subgraph.center?.hash,
          isHub: hubSet.has(n.hash),
          community: communityById.get(n.hash) ?? -1,
        },
      };
    });
  }, [subgraph.center, visibleNeighbors, positions, communityById, hubSet]);

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <Filter className="size-3" />
            Tipos
          </span>
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
          <span className="ml-auto text-muted-foreground">
            {hubSet.size > 0 ? `${hubSet.size} hubs destacados` : null}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2 text-muted-foreground" htmlFor="min-occ">
            Vínculos ≥
            <input
              id="min-occ"
              type="range"
              min={1}
              max={Math.max(1, maxOccurrences)}
              value={minOccurrences}
              onChange={(e) => setMinOccurrences(Number(e.target.value))}
              className="w-48 accent-primary"
            />
            <span className="font-mono text-foreground">
              {minOccurrences} processo{minOccurrences === 1 ? '' : 's'}
            </span>
          </label>
          <span className="text-muted-foreground">
            mostrando {finalEdges.length} de {subgraph.edges.length} conexões
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2 text-[0.7rem] text-muted-foreground">
          <span className="font-medium uppercase tracking-wider">Legenda</span>
          {(
            Object.entries(EDGE_STYLES) as Array<
              [EdgeStyleKind, (typeof EDGE_STYLES)[EdgeStyleKind]]
            >
          ).map(([k, s]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-[2px] w-6"
                style={
                  s.strokeDasharray
                    ? {
                        backgroundImage: `repeating-linear-gradient(90deg, ${s.stroke} 0 4px, transparent 4px 8px)`,
                      }
                    : { backgroundColor: s.stroke }
                }
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="h-[78vh] min-h-[600px] overflow-hidden rounded-xl border border-border bg-card">
          <ReactFlow
            nodes={finalNodes}
            edges={finalEdges}
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
