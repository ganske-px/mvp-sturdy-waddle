'use client';

import Graph from 'graphology';
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
import {
  type ConsolidatedPair,
  consolidatePairs,
  nodeScale,
  pairKey,
  pairStrokeWidth,
} from '@/lib/graph/edge-weight';
import { findShortestPath } from '@/lib/graph/path';
import type { NodeType, StoredEdgeEvidence } from '@/lib/graph/types';
import type { GraphEdgeDto, GraphNodeDto, SubgraphDto } from './actions';
import { FloatingEdge } from './floating-edge';
import { NodeDetailPanel } from './node-detail-panel';

/** True when the stored evidence comes from the process branch (has occurrences/samePolo). */
function isProcessEvidence(
  ev: StoredEdgeEvidence,
): ev is Extract<StoredEdgeEvidence, { occurrences: number }> {
  return 'occurrences' in ev;
}

type NodeData = {
  dto: GraphNodeDto;
  isCenter: boolean;
  inSpotlight: boolean;
  dimmed: boolean;
  onPath: boolean;
  isPathStart: boolean;
  /** Escala visual derivada da prominência do nó (peso persistido). */
  scale: number;
};

const PATH_HIGHLIGHT = '#fbbf24'; // amber-400

function nodeBoxShadow(data: NodeData): string | undefined {
  if (data.isPathStart) return `0 0 0 3px ${PATH_HIGHLIGHT}, 0 0 18px ${PATH_HIGHLIGHT}55`;
  if (data.onPath) return `0 0 0 2.5px ${PATH_HIGHLIGHT}`;
  if (data.dto.isPep || data.dto.hasSanction) return '0 0 0 3px #ef4444, 0 0 14px #ef444455';
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
  // A prominência aumenta o tamanho do nó; o centro mantém destaque próprio.
  const style: React.CSSProperties = {
    transform: `scale(${data.scale})`,
    transformOrigin: 'center',
    ...(shadow ? { boxShadow: shadow } : {}),
  };
  return (
    <div
      className={`transition-opacity ${baseClass} ${data.dimmed ? 'opacity-20' : 'opacity-100'}`}
      style={style}
    >
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
  | 'corporate_relation'
  | 'family_relation';

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
  family_relation: { stroke: '#db2777', strokeDasharray: '1 3', label: 'Parentesco' },
};

// Severidade para escolher a cor da aresta consolidada quando há vários tipos.
const STYLE_RANK: Record<EdgeStyleKind, number> = {
  co_party_opposed: 7,
  corporate_relation: 6,
  family_relation: 5,
  co_party_same: 4,
  client_lawyer: 3,
  lawyer_lawyer: 2,
  co_party_unknown: 1,
};

function classifyEdge(edge: GraphEdgeDto): EdgeStyleKind {
  if (edge.kind === 'client_lawyer') return 'client_lawyer';
  if (edge.kind === 'lawyer_lawyer') return 'lawyer_lawyer';
  if (edge.kind === 'corporate_relation') return 'corporate_relation';
  if (edge.kind === 'family_relation') return 'family_relation';
  if (isProcessEvidence(edge.evidence) && edge.evidence.samePolo === true) return 'co_party_same';
  if (isProcessEvidence(edge.evidence) && edge.evidence.samePolo === false)
    return 'co_party_opposed';
  return 'co_party_unknown';
}

/** Estilo dominante de um par = o de maior severidade entre suas arestas. */
function dominantStyle(constituents: GraphEdgeDto[]): EdgeStyleKind {
  return constituents
    .map(classifyEdge)
    .reduce(
      (best, s) => (STYLE_RANK[s] > STYLE_RANK[best] ? s : best),
      'co_party_unknown' as EdgeStyleKind,
    );
}

function computeLayout(
  center: GraphNodeDto,
  visibleNeighbors: GraphNodeDto[],
  visiblePairs: ConsolidatedPair[],
): { positions: Map<string, { x: number; y: number }> } {
  const positions = new Map<string, { x: number; y: number }>();
  const g = new Graph({ multi: false, type: 'undirected' });
  g.addNode(center.hash);
  for (const n of visibleNeighbors) {
    if (!g.hasNode(n.hash)) g.addNode(n.hash);
  }
  for (const p of visiblePairs) {
    if (!g.hasNode(p.a) || !g.hasNode(p.b)) continue;
    if (p.a === p.b) continue;
    if (!g.hasEdge(p.a, p.b)) g.addEdge(p.a, p.b, { weight: Math.max(1, p.weight) });
  }

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
    g.setNodeAttribute(node, 'size', node === center.hash ? 90 : 70);
  }

  const iterations = Math.min(300, Math.max(120, g.order * 3));
  try {
    forceAtlas2.assign(g, {
      iterations,
      settings: {
        gravity: 0.3,
        scalingRatio: 80,
        strongGravityMode: false,
        barnesHutOptimize: true,
        barnesHutTheta: 0.5,
        slowDown: 2,
        linLogMode: true,
        outboundAttractionDistribution: true,
        adjustSizes: true,
        edgeWeightInfluence: 1, // pares mais pesados puxam mais forte
      },
    });
  } catch {
    // Fall back to the seeded scatter.
  }

  const cx = (g.getNodeAttribute(center.hash, 'x') as number) ?? 0;
  const cy = (g.getNodeAttribute(center.hash, 'y') as number) ?? 0;
  for (const node of g.nodes()) {
    positions.set(node, {
      x: ((g.getNodeAttribute(node, 'x') as number) ?? 0) - cx,
      y: ((g.getNodeAttribute(node, 'y') as number) ?? 0) - cy,
    });
  }
  return { positions };
}

export function NetworkCanvas({ subgraph }: { subgraph: SubgraphDto }) {
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
  const [minWeight, setMinWeight] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const nodeTypes = useMemo(() => ({ cpf: CpfNode, cnpj: CnpjNode, lawyer: LawyerNode }), []);
  const edgeTypes = useMemo(() => ({ floating: FloatingEdge }), []);
  const fitViewOptions = useMemo(() => ({ padding: 0.2 }), []);
  const reactFlow = useReactFlow();

  const deferredMinWeight = useDeferredValue(minWeight);
  const deferredHiddenTypes = useDeferredValue(hiddenTypes);
  const deferredHiddenEdgeKinds = useDeferredValue(hiddenEdgeKinds);

  const counts = useMemo(() => {
    const result: Record<NodeType, number> = { cpf: 0, cnpj: 0, lawyer: 0 };
    for (const n of subgraph.neighbors) result[n.type]++;
    return result;
  }, [subgraph.neighbors]);

  const candidateHashes = useMemo(() => {
    const s = new Set<string>();
    if (subgraph.center) s.add(subgraph.center.hash);
    for (const n of subgraph.neighbors) {
      if (!deferredHiddenTypes.has(n.type)) s.add(n.hash);
    }
    return s;
  }, [subgraph.center, subgraph.neighbors, deferredHiddenTypes]);

  // Arestas cruas que sobrevivem ao filtro de tipo de nó e de tipo de relação.
  const typeFilteredEdges = useMemo(
    () =>
      subgraph.edges.filter(
        (e) =>
          candidateHashes.has(e.source) &&
          candidateHashes.has(e.target) &&
          !deferredHiddenEdgeKinds.has(classifyEdge(e)),
      ),
    [subgraph.edges, candidateHashes, deferredHiddenEdgeKinds],
  );

  // Constituintes por par (para cor dominante e drill-down no painel).
  const constituentsByPair = useMemo(() => {
    const m = new Map<string, GraphEdgeDto[]>();
    for (const e of typeFilteredEdges) {
      const key = pairKey(e.source, e.target);
      const arr = m.get(key) ?? [];
      arr.push(e);
      m.set(key, arr);
    }
    return m;
  }, [typeFilteredEdges]);

  const allPairs = useMemo(
    () =>
      consolidatePairs(
        typeFilteredEdges.map((e) => ({
          source: e.source,
          target: e.target,
          kind: e.kind,
          weight: e.weight,
        })),
      ),
    [typeFilteredEdges],
  );

  const maxWeight = useMemo(() => {
    let max = 1;
    for (const p of allPairs.values()) if (p.weight > max) max = p.weight;
    return Math.ceil(max);
  }, [allPairs]);

  // Pares que sobrevivem ao slider de força.
  const visiblePairs = useMemo(
    () => [...allPairs.values()].filter((p) => p.weight >= deferredMinWeight),
    [allPairs, deferredMinWeight],
  );

  const connectedHashes = useMemo(() => {
    const s = new Set<string>();
    if (subgraph.center) s.add(subgraph.center.hash);
    for (const p of visiblePairs) {
      s.add(p.a);
      s.add(p.b);
    }
    return s;
  }, [visiblePairs, subgraph.center]);

  const visibleNeighbors = useMemo(
    () => subgraph.neighbors.filter((n) => connectedHashes.has(n.hash)),
    [subgraph.neighbors, connectedHashes],
  );

  const { positions } = useMemo(() => {
    if (!subgraph.center) return { positions: new Map<string, { x: number; y: number }>() };
    return computeLayout(subgraph.center, visibleNeighbors, visiblePairs);
  }, [subgraph.center, visibleNeighbors, visiblePairs]);

  // Caminho mais curto roda sobre os pares visíveis (um "edge" por par).
  const pathEdges = useMemo(
    () => visiblePairs.map((p) => ({ source: p.a, target: p.b })),
    [visiblePairs],
  );
  const path = useMemo(() => {
    if (!pathStart || !selectedHash || pathStart === selectedHash) return null;
    return findShortestPath(pathEdges, pathStart, selectedHash);
  }, [pathStart, selectedHash, pathEdges]);

  const spotlight = useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Set<string>(); // por pairKey
    if (path) {
      for (const h of path.nodes) nodes.add(h);
      for (let i = 0; i < path.nodes.length - 1; i++) {
        const a = path.nodes[i];
        const b = path.nodes[i + 1];
        if (a && b) edges.add(pairKey(a, b));
      }
      return { nodes, edges, kind: 'path' as const };
    }
    if (hoveredHash) {
      nodes.add(hoveredHash);
      for (const p of visiblePairs) {
        if (p.a === hoveredHash || p.b === hoveredHash) {
          edges.add(pairKey(p.a, p.b));
          nodes.add(p.a);
          nodes.add(p.b);
        }
      }
      return { nodes, edges, kind: 'hover' as const };
    }
    return null;
  }, [path, hoveredHash, visiblePairs]);

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

  const finalEdges = useMemo<Edge[]>(
    () =>
      visiblePairs.map((p) => {
        const key = pairKey(p.a, p.b);
        const constituents = constituentsByPair.get(key) ?? [];
        const styleKind = dominantStyle(constituents);
        const style = EDGE_STYLES[styleKind];
        const widthBase = pairStrokeWidth(p.weight, p.diversity);
        const onPath = spotlight?.kind === 'path' && spotlight.edges.has(key);
        const inHover = spotlight?.kind === 'hover' && spotlight.edges.has(key);
        const dimmed = spotlight !== null && !spotlight.edges.has(key);
        return {
          id: key,
          source: p.a,
          target: p.b,
          type: 'floating',
          // Pares multi-tipo nunca tracejam (linha cheia = vínculo "forte/denso").
          style: {
            stroke: onPath ? PATH_HIGHLIGHT : style.stroke,
            strokeDasharray: onPath || p.diversity > 1 ? undefined : style.strokeDasharray,
            strokeWidth: onPath ? widthBase + 1.5 : widthBase,
            opacity: dimmed ? 0.08 : inHover || onPath ? 1 : 0.7,
          },
        };
      }),
    [visiblePairs, constituentsByPair, spotlight],
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
          inSpotlight,
          dimmed,
          onPath,
          isPathStart: n.hash === pathStart,
          scale: n.hash === subgraph.center?.hash ? 1 : nodeScale(n.weight),
        },
      };
    });
  }, [subgraph.center, visibleNeighbors, positions, spotlight, pathStart]);

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
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-foreground/20 bg-foreground/5 px-2.5 py-1 text-foreground"
          >
            <Filter className="size-3" />
            Filtros {showAdvanced ? '▾' : '▸'}
          </button>
          <span className="ml-auto text-muted-foreground">
            mostrando {visibleNeighbors.length} de {subgraph.neighbors.length} vizinhos ·{' '}
            {finalEdges.length} vínculo(s)
          </span>
        </div>

        {showAdvanced ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
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
              <label className="flex items-center gap-2 text-muted-foreground" htmlFor="min-weight">
                Força ≥
                <input
                  id="min-weight"
                  type="range"
                  min={1}
                  max={Math.max(1, maxWeight)}
                  value={minWeight}
                  onChange={(e) => setMinWeight(Number(e.target.value))}
                  className="w-48 accent-primary"
                />
                <span className="font-mono text-foreground">{minWeight}</span>
              </label>
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
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-[3px] w-6 rounded bg-foreground" />
                linha mais grossa = vínculo mais forte
              </span>
            </div>
          </>
        ) : null}
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
            onEdgeClick={(_, edge) => {
              // Selecionar a aresta abre o detalhe do par no painel: escolhe o
              // endpoint que não é o centro (ou a origem) para focar o vínculo.
              const other = edge.source === subgraph.center?.hash ? edge.target : edge.source;
              setSelectedHash(other);
            }}
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
