'use server';

import { extractRequestContext, writeAuditLog } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/permissions';
import { planNodeInvestigation } from '@/lib/graph/investigate-plan';
import { decryptLabel, decryptLabels } from '@/lib/graph/label-crypto';
import { buildPathResult } from '@/lib/graph/path-result';
import type { EdgeKind, GraphNodeLabel, NodeType, StoredEdgeEvidence } from '@/lib/graph/types';
import { hashDocument } from '@/lib/hash';
import { runCnpjSearch, runCpfSearch } from '@/lib/predictus/run-search';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

// Each hash is 64 chars; PostgREST .in() builds a URL-encoded list, and going
// past ~370 hashes blew the URL past fetch's limit ("TypeError: fetch failed").
// Chunk to 100 — comfortably below the limit and only a few round-trips.
const HASH_QUERY_BATCH = 100;

export type GraphNodeDto = {
  hash: string;
  type: NodeType;
  label: GraphNodeLabel;
  maskedPreview: string;
  isPep: boolean;
  hasSanction: boolean;
  lastSeenAt: string;
};

export type GraphEdgeDto = {
  source: string;
  target: string;
  kind: EdgeKind;
  evidence: StoredEdgeEvidence;
  lastSeenAt: string;
};

export type SubgraphDto = {
  center: GraphNodeDto | null;
  neighbors: GraphNodeDto[];
  edges: GraphEdgeDto[];
};

type NodeRow = {
  node_hash: string;
  node_type: NodeType;
  encrypted_label: string;
  masked_preview: string;
  is_pep: boolean;
  has_sanction: boolean;
  last_seen_at: string;
};

type EdgeRow = {
  source_hash: string;
  target_hash: string;
  kind: EdgeKind;
  evidence: StoredEdgeEvidence;
  last_seen_at: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;
type ServerClient = SupabaseClient<Database>;

async function fetchNodesInChunks(supabase: ServerClient, hashes: string[]): Promise<NodeRow[]> {
  if (hashes.length === 0) return [];
  const result: NodeRow[] = [];
  for (let i = 0; i < hashes.length; i += HASH_QUERY_BATCH) {
    const chunk = hashes.slice(i, i + HASH_QUERY_BATCH);
    const { data, error } = await supabase
      .from('graph_nodes')
      .select(
        'node_hash, node_type, encrypted_label, masked_preview, last_seen_at, is_pep, has_sanction',
      )
      .in('node_hash', chunk)
      .returns<NodeRow[]>();
    if (error) throw new Error(`fetchNodesInChunks failed: ${error.message}`);
    if (data) result.push(...data);
  }
  return result;
}

function nodeRowToDto(row: NodeRow, label: GraphNodeLabel): GraphNodeDto {
  return {
    hash: row.node_hash,
    type: row.node_type,
    label,
    maskedPreview: row.masked_preview,
    isPep: row.is_pep,
    hasSanction: row.has_sanction,
    lastSeenAt: row.last_seen_at,
  };
}

async function rowToDto(admin: AdminClient, row: NodeRow): Promise<GraphNodeDto> {
  let label: GraphNodeLabel = {};
  try {
    const plaintext = await decryptLabel(admin, row.encrypted_label);
    label = JSON.parse(plaintext) as GraphNodeLabel;
  } catch (e) {
    console.warn('label decrypt failed; falling back to masked preview:', e);
  }
  return nodeRowToDto(row, label);
}

async function rowsToDtosBatched(admin: AdminClient, rows: NodeRow[]): Promise<GraphNodeDto[]> {
  if (rows.length === 0) return [];
  let plaintexts: string[] = [];
  try {
    plaintexts = await decryptLabels(
      admin,
      rows.map((r) => r.encrypted_label),
    );
  } catch (e) {
    console.warn('batch label decrypt failed; falling back to masked previews:', e);
  }
  return rows.map((row, i) => {
    let label: GraphNodeLabel = {};
    try {
      const pt = plaintexts[i];
      if (pt != null) label = JSON.parse(pt) as GraphNodeLabel;
    } catch (e) {
      console.warn('label parse failed; using masked preview:', e);
    }
    return nodeRowToDto(row, label);
  });
}

export async function getSubgraph(centerHash: string): Promise<SubgraphDto> {
  const user = await requirePermission('search_network');
  const admin = createAdminClient();
  const supabase = await createClient();

  const { data: centerRow } = await supabase
    .from('graph_nodes')
    .select(
      'node_hash, node_type, encrypted_label, masked_preview, last_seen_at, is_pep, has_sanction',
    )
    .eq('node_hash', centerHash)
    .maybeSingle()
    .returns<NodeRow>();

  const requestContext = extractRequestContext(await headers());

  if (!centerRow) {
    await writeAuditLog(
      {
        userId: user.id,
        action: 'view_network',
        documentHash: centerHash,
        metadata: { neighbors_count: 0, found: false },
        ip: requestContext.ip,
        userAgent: requestContext.userAgent,
      },
      admin,
      { allowFailure: true },
    );
    return { center: null, neighbors: [], edges: [] };
  }

  const { data: edgeRows } = await supabase
    .from('graph_edges')
    .select('source_hash, target_hash, kind, evidence, last_seen_at')
    .or(`source_hash.eq.${centerHash},target_hash.eq.${centerHash}`)
    .returns<EdgeRow[]>();

  const edges: EdgeRow[] = edgeRows ?? [];
  const neighborHashes = Array.from(
    new Set(edges.flatMap((e) => [e.source_hash, e.target_hash]).filter((h) => h !== centerHash)),
  );

  const neighborRows = await fetchNodesInChunks(supabase, neighborHashes);

  const center = await rowToDto(admin, centerRow);
  const neighbors = await rowsToDtosBatched(admin, neighborRows);

  await writeAuditLog(
    {
      userId: user.id,
      action: 'view_network',
      documentHash: centerHash,
      metadata: { neighbors_count: neighbors.length, found: true },
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
    },
    admin,
    { allowFailure: true },
  );

  return {
    center,
    neighbors,
    edges: edges.map((e) => ({
      source: e.source_hash,
      target: e.target_hash,
      kind: e.kind,
      evidence: e.evidence,
      lastSeenAt: e.last_seen_at,
    })),
  };
}

export type PathBetweenDto = {
  found: boolean;
  nodes: GraphNodeDto[];
  hops: number;
};

const PATH_EDGE_PAGE = 1000;

async function fetchAllEdges(
  supabase: ServerClient,
): Promise<Array<{ source: string; target: string }>> {
  const all: Array<{ source: string; target: string }> = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('graph_edges')
      .select('source_hash, target_hash')
      .range(from, from + PATH_EDGE_PAGE - 1)
      .returns<Array<{ source_hash: string; target_hash: string }>>();
    if (error) throw new Error(`fetchAllEdges failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) all.push({ source: r.source_hash, target: r.target_hash });
    if (rows.length < PATH_EDGE_PAGE) break;
    from += PATH_EDGE_PAGE;
  }
  return all;
}

export async function findPathBetween(hashA: string, hashB: string): Promise<PathBetweenDto> {
  await requirePermission('search_network');
  const admin = createAdminClient();
  const supabase = await createClient();

  const edges = await fetchAllEdges(supabase);
  const path = buildPathResult(edges, hashA, hashB);
  if (!path.found) return { found: false, nodes: [], hops: 0 };

  const rows = await fetchNodesInChunks(supabase, path.nodes);
  const byHash = new Map(rows.map((r) => [r.node_hash, r] as const));

  // Preserva a ordem do caminho; ignora hashes sem nó (não deveria ocorrer).
  const ordered = path.nodes.map((h) => byHash.get(h)).filter((r): r is NodeRow => r !== undefined);
  const nodes = await rowsToDtosBatched(admin, ordered);

  return { found: true, nodes, hops: path.hops };
}

export async function findPathToDocument(
  centerHash: string,
  type: 'cpf' | 'cnpj',
  rawValue: string,
): Promise<PathBetweenDto> {
  await requirePermission('search_network');
  const targetHash = hashDocument(type, rawValue);
  return findPathBetween(centerHash, targetHash);
}

export type InvestigateResult = { ok: false; error: string };

/**
 * Dispara a investigação completa (Predictus async + Netrin) a partir de um nó
 * da rede. O documento em claro é recuperado do `encrypted_label` no servidor —
 * nunca confiando em input do cliente. Em sucesso, redireciona para a página de
 * resultado (que renderiza skeleton + realtime enquanto a busca está pending) e
 * a função não retorna. Só retorna em caso de erro.
 */
export async function investigateNode(hash: string): Promise<InvestigateResult> {
  // Server Actions are HTTP endpoints: gate `search_network` here too — não basta
  // a página de rede estar protegida. A permissão por tipo de busca vem depois,
  // quando já se conhece o node_type.
  const user = await requirePermission('search_network');

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: row } = await supabase
    .from('graph_nodes')
    .select('node_hash, node_type, encrypted_label')
    .eq('node_hash', hash)
    .maybeSingle()
    .returns<{ node_hash: string; node_type: NodeType; encrypted_label: string }>();
  if (!row) return { ok: false, error: 'Nó não encontrado na rede.' };

  let document: string | undefined;
  try {
    const label = JSON.parse(await decryptLabel(admin, row.encrypted_label)) as GraphNodeLabel;
    document = label.document;
  } catch (e) {
    console.warn('investigateNode label decrypt failed:', e);
  }

  const plan = planNodeInvestigation({ type: row.node_type, document });
  if (!plan.ok) return plan;

  await requirePermission(plan.type === 'cpf' ? 'search_person' : 'search_company');

  const requestContext = extractRequestContext(await headers());
  const ctx = {
    userId: user.id,
    admin,
    supabase,
    ip: requestContext.ip ?? null,
    userAgent: requestContext.userAgent ?? null,
  };
  const result =
    plan.type === 'cpf'
      ? await runCpfSearch(plan.document, ctx)
      : await runCnpjSearch(plan.document, ctx);
  if (!result.ok) return result;
  redirect(`/search/result/${encodeURIComponent(result.documentHash)}`);
}
