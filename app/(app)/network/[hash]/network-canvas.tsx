'use client';

import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { Building2, Filter, Scale, User } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { findShortestPath } from '@/lib/graph/path';
import type { NodeType, StoredEdgeEvidence } from '@/lib/graph/types';

/** True when the stored evidence comes from the process (co_party/client_lawyer/lawyer_lawyer) branch. */
function isProcessEvidence(
  ev: StoredEdgeEvidence,
): ev is Extract<StoredEdgeEvidence, { occurrences: number }> {
  return 'occurrences' in ev;
}
import type { GraphEdgeDto, GraphNodeDto, SubgraphDto } from './actions';
import { FloatingEdge } from './floating-edge';
import { NodeDetailPanel } from './node-detail-panel';

type NodeData = {
  dto: GraphNodeDto;
  isCenter: boolean;
  isHub: boolean;
  community: number;
  /** true when there's an active spotlight (hover/path) and this node is in it */
  inSpotlight: boolean;
  /** true when a spotlight is active and this node is NOT in it */
  dimmed: boolean;
  /** true when this node is part of the active path */
  onPath: boolean;
  /** true when this node is the path origin */
  isPathStart: boolean;
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

const PATH_HIGHLIGHT = '#fbbf24'; // amber-400

function nodeBoxShadow(data: NodeData): string | undefined {
  // Path origin gets a bright amber halo so it stays anchored visually.
  if (data.isPathStart) return `0 0 0 3px ${PATH_HIGHLIGHT}, 0 0 18px ${PATH_HIGHLIGHT}55`;
  // Other nodes on the path: amber ring.
  if (data.onPath) return `0 0 0 2.5px ${PATH_HIGHLIGHT}`;
  // Hubs (top-5 by weighted degree) wear their community colour — the only
  // place community colour appears, so it never competes with type colour
  // on every node.
  if (data.isHub) return `0 0 0 3px ${communityColor(data.community)}`;
  return undefined;
}

function NodeShell({
  data,
  baseClass,
  Icon,
  iconClass,
}: {
  data: NodeData;
  baseClass: string;
  Icon: typeof User;
  iconClass?: string;
}) {
  const shadow = nodeBoxShadow(data);
  return (
    <div
      className={`transition-opacity ${baseClass} ${data.dimmed ? 'opacity-20' : 'opacity-100'}`}
      style={shadow ? { boxShadow: shadow } : undefined}
    >
      {/* Invisible handles — floating edges derive endpoints from the node
          geometry instead of these positions, so a single handle pair is fine. */}
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Icon className={`size-3 shrink-0 ${iconClass ?? ''}`} />
      <span className="truncate font-medium">{data.dto.label.name ?? data.dto.maskedPreview}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

function CpfNode({ data }: NodeProps<NodeData>) {
  const sizing = data.isCenter ? 'px-3 py-1.5 text-[0.7rem]' : 'px-2 py-1 text-[0.6rem]';
  const border = data.isCenter
    ? 'border-2 border-primary ring-2 ring-primary/30'
    : 'border-2 border-primary/70';
  return (
    <NodeShell
      data={data}
      Icon={User}
      iconClass="text-primary"
      // Solid bg-card so edges that pass behind the node don't bleed through
      // the label. Type colour lives in the border + icon instead.
      baseClass={`flex max-w-[160px] items-center gap-1.5 rounded-full bg-card shadow-sm ${sizing} ${border}`}
    />
  );
}

function CnpjNode({ data }: NodeProps<NodeData>) {
  const sizing = data.isCenter ? 'px-3 py-1.5 text-[0.7rem]' : 'px-2 py-1 text-[0.6rem]';
  const border = data.isCenter
    ? 'border-2 border-accent ring-2 ring-accent/30'
    : 'border-2 border-accent/70';
  return (
    <NodeShell
      data={data}
      Icon={Building2}
      iconClass="text-accent-foreground"
      baseClass={`flex max-w-[160px] items-center gap-1.5 rounded-md bg-card shadow-sm ${sizing} ${border}`}
    />
  );
}

function LawyerNode({ data }: NodeProps<NodeData>) {
  return (
    <NodeShell
      data={data}
      Icon={Scale}
      iconClass="text-muted-foreground"
      baseClass="flex max-w-[160px] items-center gap-1.5 rounded-sm border-2 border-border bg-card px-2 py-1 text-[0.6rem] shadow-sm"
    />
  );
}

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
  | 'lawyer_lawyer'
  | 'corporate_relation';

const EDGE_STYLES: Record<
  EdgeStyleKind,
  { stroke: string; strokeDasharray?: string; label: string }
> = {
  co_party_same: { stroke: '#22c55e', label: 'Mesmo polo' },
  co_party_opposed: { stroke: '#ef4444', label: 'Polos opostos' },
  co_party_unknown: { stroke: '#71717a', label: 'Co-parte (polo n/d)' },
  client_lawyer: { stroke: '#0ea5e9', strokeDasharray: '6 4', label: 'Representação' },
  lawyer_lawyer: { stroke: '#7c3aed', strokeDasharray: '2 4', label: 'Advogado ↔ advogado' },
  corporate_relation: { stroke: '#1d4ed8', strokeDasharray: '4 3', label: 'Vínculo societário' },
};

function classifyEdge(edge: GraphEdgeDto): EdgeStyleKind {
  if (edge.kind === 'client_lawyer') return 'client_lawyer';
  if (edge.kind === 'lawyer_lawyer') return 'lawyer_lawyer';
  if (edge.kind === 'corporate_relation') return 'corporate_relation';
  if (isProcessEvidence(edge.evidence) && edge.evidence.samePolo === true) return 'co_party_same';
  if (isProcessEvidence(edge.evidence) && edge.evidence.samePolo === false)
    return 'co_party_opposed';
  return 'co_party_unknown';
}

const MAX_HUBS = 5;

// Scale the number of "hubs" highlighted to the visible neighbour count so
// sparse views don't end up with most nodes ringed in community colour. With
// just 8 neighbours every node was being flagged a hub — visual noise instead
// of signal.
function hubBudget(neighbourCount: number): number {
  if (neighbourCount < 6) return 0;
  return Math.min(MAX_HUBS, Math.floor((neighbourCount - 5) / 3));
}

// Builds a graphology graph for the *visible* subset, runs Louvain for
// community assignment, then ForceAtlas2 for positions. Recomputed every
// time the visible set changes (type filter, occurrences slider) so the
// remaining nodes spread into the freed space instead of staying clustered
// where the old layout put them.
function computeLayout(
  center: GraphNodeDto,
  visibleNeighbors: GraphNodeDto[],
  visibleEdges: GraphEdgeDto[],
): {
  positions: Map<string, { x: number; y: number }>;
  communityById: Map<string, number>;
  hubSet: Set<string>;
} {
  const positions = new Map<string, { x: number; y: number }>();
  const communityById = new Map<string, number>();
  const hubSet = new Set<string>();

  const g = new Graph({ multi: false, type: 'undirected' });
  g.addNode(center.hash);
  for (const n of visibleNeighbors) {
    if (!g.hasNode(n.hash)) g.addNode(n.hash);
  }

  for (const e of visibleEdges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    if (e.source === e.target) continue;
    const weight = Math.max(1, isProcessEvidence(e.evidence) ? (e.evidence.occurrences ?? 1) : 1);
    if (g.hasEdge(e.source, e.target)) {
      const cur = g.getEdgeAttribute(e.source, e.target, 'weight') ?? 1;
      g.setEdgeAttribute(e.source, e.target, 'weight', Math.max(cur, weight));
    } else {
      g.addEdge(e.source, e.target, { weight });
    }
  }

  // Seed with a wide scatter so FA2 has gradient to work with even on small
  // graphs — a tight initial cluster + low repulsion would otherwise leave
  // 5-10 nodes piled on top of each other.
  const seedRadius = Math.max(400, g.order * 30);
  for (const node of g.nodes()) {
    if (node === center.hash) {
      g.setNodeAttribute(node, 'x', 0);
      g.setNodeAttribute(node, 'y', 0);
    } else {
      const angle = Math.random() * Math.PI * 2;
      const r = seedRadius * (0.5 + Math.random() * 0.5);
      g.setNodeAttribute(node, 'x', r * Math.cos(angle));
      g.setNodeAttribute(node, 'y', r * Math.sin(angle));
    }
    // FA2's adjustSizes treats this as a half-width — set generously so dense
    // labels don't end up overlapping. Real rendered width is ~120-160px so a
    // size of ~70-90 keeps comfortable padding between nodes.
    g.setNodeAttribute(node, 'size', node === center.hash ? 90 : 70);
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

  const iterations = Math.min(300, Math.max(120, g.order * 3));
  try {
    forceAtlas2.assign(g, {
      iterations,
      settings: {
        // Higher scalingRatio + lower gravity stops a 5–10 node graph from
        // collapsing into a single overlapping stack. linLogMode keeps the
        // overall scale sane for both 10-node and 700-node subgraphs.
        gravity: 0.3,
        scalingRatio: 80,
        strongGravityMode: false,
        barnesHutOptimize: true,
        barnesHutTheta: 0.5,
        slowDown: 2,
        linLogMode: true,
        // Distributes hubs to the periphery instead of clumping with their
        // neighbours — gives the centre breathing room.
        outboundAttractionDistribution: true,
        adjustSizes: true,
        edgeWeightInfluence: 0.5,
      },
    });
  } catch {
    // Fall back to the seeded scatter.
  }

  // Translate so the centre node sits at (0, 0) — keeps the visual focus on
  // the searched entity, matters when the user pans/zooms.
  const cx = (g.getNodeAttribute(center.hash, 'x') as number) ?? 0;
  const cy = (g.getNodeAttribute(center.hash, 'y') as number) ?? 0;
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
  const budget = hubBudget(visibleNeighbors.length);
  if (budget > 0) {
    const ranked = [...weightedDegree.entries()]
      .filter(([h]) => h !== center.hash)
      .sort((a, b) => b[1] - a[1])
      .slice(0, budget);
    for (const [h] of ranked) hubSet.add(h);
  }

  return { positions, communityById, hubSet };
}

export function NetworkCanvas({ subgraph }: { subgraph: SubgraphDto }) {
  // ReactFlowProvider is needed so InnerCanvas can call useReactFlow().fitView
  // when filters change — without it the camera stays parked on the old layout
  // extent and the new (smaller) graph just looks tiny in the middle.
  return (
    <ReactFlowProvider>
      <InnerCanvas subgraph={subgraph} />
    </ReactFlowProvider>
  );
}

function InnerCanvas({ subgraph }: { subgraph: SubgraphDto }) {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const [pathStart, setPathStart] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set());
  const [hiddenEdgeKinds, setHiddenEdgeKinds] = useState<Set<EdgeStyleKind>>(new Set());
  const [minOccurrences, setMinOccurrences] = useState(1);

  // React Flow warns when nodeTypes is a new reference each render; with HMR
  // a module-level const gets recreated on every Fast Refresh. Binding the
  // map to the component instance via useMemo silences the false positive.
  const nodeTypes = useMemo(() => ({ cpf: CpfNode, cnpj: CnpjNode, lawyer: LawyerNode }), []);
  const edgeTypes = useMemo(() => ({ floating: FloatingEdge }), []);
  const fitViewOptions = useMemo(() => ({ padding: 0.2 }), []);
  const reactFlow = useReactFlow();

  // Defer the slider value so dragging through 100 stops doesn't kick off
  // 100 force-layout runs; React will skip stale updates and only land on
  // the value the user settles on (or an intermediate one as CPU frees up).
  const deferredMinOccurrences = useDeferredValue(minOccurrences);
  const deferredHiddenTypes = useDeferredValue(hiddenTypes);
  const deferredHiddenEdgeKinds = useDeferredValue(hiddenEdgeKinds);

  const maxOccurrences = useMemo(() => {
    let max = 1;
    for (const e of subgraph.edges) {
      const w = isProcessEvidence(e.evidence) ? (e.evidence.occurrences ?? 1) : 1;
      if (w > max) max = w;
    }
    return max;
  }, [subgraph.edges]);

  const counts = useMemo(() => {
    const result: Record<NodeType, number> = { cpf: 0, cnpj: 0, lawyer: 0 };
    for (const n of subgraph.neighbors) result[n.type]++;
    return result;
  }, [subgraph.neighbors]);

  // Visibility composes left-to-right: type filter narrows candidates, the
  // occurrences slider keeps only strong edges, then any candidate left with
  // no surviving edge to the rest of the visible graph is dropped — otherwise
  // raising the slider would leave orphan nodes floating around.
  const candidateHashes = useMemo(() => {
    const s = new Set<string>();
    if (subgraph.center) s.add(subgraph.center.hash);
    for (const n of subgraph.neighbors) {
      if (!deferredHiddenTypes.has(n.type)) s.add(n.hash);
    }
    return s;
  }, [subgraph.center, subgraph.neighbors, deferredHiddenTypes]);

  const keptEdgeDtos = useMemo(
    () =>
      subgraph.edges.filter(
        (e) =>
          candidateHashes.has(e.source) &&
          candidateHashes.has(e.target) &&
          !deferredHiddenEdgeKinds.has(classifyEdge(e)) &&
          (isProcessEvidence(e.evidence) ? (e.evidence.occurrences ?? 1) : 1) >=
            deferredMinOccurrences,
      ),
    [subgraph.edges, candidateHashes, deferredHiddenEdgeKinds, deferredMinOccurrences],
  );

  const connectedHashes = useMemo(() => {
    const s = new Set<string>();
    if (subgraph.center) s.add(subgraph.center.hash);
    for (const e of keptEdgeDtos) {
      s.add(e.source);
      s.add(e.target);
    }
    return s;
  }, [keptEdgeDtos, subgraph.center]);

  const visibleNeighbors = useMemo(
    () => subgraph.neighbors.filter((n) => connectedHashes.has(n.hash)),
    [subgraph.neighbors, connectedHashes],
  );

  // Recompute layout + communities + hubs on every change to the visible
  // subset, so the remaining nodes spread into the freed space.
  const { positions, communityById, hubSet } = useMemo(() => {
    if (!subgraph.center) {
      return {
        positions: new Map<string, { x: number; y: number }>(),
        communityById: new Map<string, number>(),
        hubSet: new Set<string>(),
      };
    }
    return computeLayout(subgraph.center, visibleNeighbors, keptEdgeDtos);
  }, [subgraph.center, visibleNeighbors, keptEdgeDtos]);

  // Shortest path: only computed when both endpoints are set and distinct.
  // Runs on the *visible* edges so the path respects active filters — if the
  // user raised the slider so the path no longer exists, they see "no path".
  const path = useMemo(() => {
    if (!pathStart || !selectedHash || pathStart === selectedHash) return null;
    return findShortestPath(keptEdgeDtos, pathStart, selectedHash);
  }, [pathStart, selectedHash, keptEdgeDtos]);

  // Spotlight: when a path is active, that's the focus; otherwise hover.
  // Used to dim everything outside the focus.
  const spotlight = useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Set<number>();
    if (path) {
      for (const h of path.nodes) nodes.add(h);
      for (const i of path.edgeIndices) edges.add(i);
      return { nodes, edges, kind: 'path' as const };
    }
    if (hoveredHash) {
      nodes.add(hoveredHash);
      for (let i = 0; i < keptEdgeDtos.length; i++) {
        const e = keptEdgeDtos[i];
        if (!e) continue;
        if (e.source === hoveredHash || e.target === hoveredHash) {
          edges.add(i);
          nodes.add(e.source);
          nodes.add(e.target);
        }
      }
      return { nodes, edges, kind: 'hover' as const };
    }
    return null;
  }, [path, hoveredHash, keptEdgeDtos]);

  const pathNodesByHash = useMemo(() => {
    const m = new Map<string, GraphNodeDto>();
    if (subgraph.center) m.set(subgraph.center.hash, subgraph.center);
    for (const n of subgraph.neighbors) m.set(n.hash, n);
    return m;
  }, [subgraph.center, subgraph.neighbors]);

  const pathStartNode = pathStart ? (pathNodesByHash.get(pathStart) ?? null) : null;

  const selectedNode =
    selectedHash === null
      ? null
      : subgraph.center?.hash === selectedHash
        ? subgraph.center
        : (subgraph.neighbors.find((n) => n.hash === selectedHash) ?? null);

  const selectedCommunity = selectedHash ? (communityById.get(selectedHash) ?? -1) : -1;
  const membersInSameCommunity = useMemo(() => {
    if (selectedCommunity < 0) return [];
    const out: GraphNodeDto[] = [];
    if (subgraph.center && communityById.get(subgraph.center.hash) === selectedCommunity) {
      out.push(subgraph.center);
    }
    for (const n of visibleNeighbors) {
      if (communityById.get(n.hash) === selectedCommunity) out.push(n);
    }
    return out;
  }, [selectedCommunity, subgraph.center, visibleNeighbors, communityById]);

  const finalEdges = useMemo<Edge[]>(
    () =>
      keptEdgeDtos.map((e, i) => {
        const kind = classifyEdge(e);
        const style = EDGE_STYLES[kind];
        const widthBase = Math.min(
          5,
          1 + (isProcessEvidence(e.evidence) ? (e.evidence.occurrences ?? 1) : 1) * 0.4,
        );
        const onPath = spotlight?.kind === 'path' && spotlight.edges.has(i);
        const inHover = spotlight?.kind === 'hover' && spotlight.edges.has(i);
        const dimmed = spotlight !== null && !spotlight.edges.has(i);
        return {
          id: `e-${i}`,
          source: e.source,
          target: e.target,
          type: 'floating',
          style: {
            stroke: onPath ? PATH_HIGHLIGHT : style.stroke,
            strokeDasharray: onPath ? undefined : style.strokeDasharray,
            strokeWidth: onPath ? widthBase + 1.5 : widthBase,
            opacity: dimmed ? 0.08 : inHover || onPath ? 1 : 0.7,
          },
        };
      }),
    [keptEdgeDtos, spotlight],
  );

  const finalNodes = useMemo<Node<NodeData>[]>(() => {
    if (!subgraph.center) return [];
    const pool: GraphNodeDto[] = [subgraph.center, ...visibleNeighbors];
    return pool.map((n) => {
      const pos = positions.get(n.hash) ?? { x: 0, y: 0 };
      const inSpotlight = spotlight?.nodes.has(n.hash) ?? false;
      const dimmed = spotlight !== null && !inSpotlight;
      const onPath = spotlight?.kind === 'path' && spotlight.nodes.has(n.hash);
      return {
        id: n.hash,
        type: n.type,
        position: pos,
        data: {
          dto: n,
          isCenter: n.hash === subgraph.center?.hash,
          isHub: hubSet.has(n.hash),
          community: communityById.get(n.hash) ?? -1,
          inSpotlight,
          dimmed,
          onPath,
          isPathStart: n.hash === pathStart,
        },
      };
    });
  }, [subgraph.center, visibleNeighbors, positions, communityById, hubSet, spotlight, pathStart]);

  // Re-fit the camera whenever the visible set changes. The layout has new
  // positions but the viewport would otherwise stay parked on the old
  // extent — leaving the remaining nodes huddled in one corner.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reactFlow.fitView is stable across renders
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      reactFlow.fitView({ padding: 0.2, duration: 400 });
    });
    return () => cancelAnimationFrame(id);
  }, [finalNodes.length, finalEdges.length, reactFlow]);

  function toggleType(t: NodeType) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function toggleEdgeKind(k: EdgeStyleKind) {
    setHiddenEdgeKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
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
          <span className="mx-1 text-border">|</span>
          <span className="text-muted-foreground">Relações</span>
          <button
            type="button"
            onClick={() => toggleEdgeKind('corporate_relation')}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
              hiddenEdgeKinds.has('corporate_relation')
                ? 'border-border bg-transparent text-muted-foreground line-through'
                : 'border-foreground/20 bg-foreground/5 text-foreground'
            }`}
          >
            <span
              aria-hidden
              className="inline-block h-[2px] w-4 rounded"
              style={{ backgroundColor: EDGE_STYLES.corporate_relation.stroke }}
            />
            Societário
          </button>
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
            mostrando {visibleNeighbors.length} de {subgraph.neighbors.length} vizinhos ·{' '}
            {finalEdges.length} de {subgraph.edges.length} conexões
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
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, n) => setSelectedHash(n.id)}
            onNodeMouseEnter={(_, n) => setHoveredHash(n.id)}
            onNodeMouseLeave={() => setHoveredHash(null)}
            onPaneClick={() => setHoveredHash(null)}
            fitView
            fitViewOptions={fitViewOptions}
            minZoom={0.05}
          >
            <Background gap={24} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        <NodeDetailPanel
          node={selectedNode}
          center={subgraph.center}
          edges={subgraph.edges}
          community={selectedCommunity}
          membersInSameCommunity={membersInSameCommunity}
          pathStart={pathStart}
          pathStartNode={pathStartNode}
          path={path}
          pathNodesByHash={pathNodesByHash}
          onSetPathStart={setPathStart}
          onClearPathStart={() => setPathStart(null)}
          onPickNode={setSelectedHash}
        />
      </div>
    </div>
  );
}
