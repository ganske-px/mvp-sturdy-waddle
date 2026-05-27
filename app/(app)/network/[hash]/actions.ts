'use server';

import { extractRequestContext, writeAuditLog } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/permissions';
import { decryptLabel } from '@/lib/graph/label-crypto';
import { buildPathResult } from '@/lib/graph/path-result';
import type { EdgeKind, GraphNodeLabel, NodeType, StoredEdgeEvidence } from '@/lib/graph/types';
import { hashDocument } from '@/lib/hash';
import { setCachedResults } from '@/lib/predictus/cache';
import { createServerPredictusClient } from '@/lib/predictus/server-client';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';
import { isValid as isCnpjValid } from '@/lib/validators/cnpj';
import { isValid as isCpfValid } from '@/lib/validators/cpf';
import type { SupabaseClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

// Each hash is 64 chars; PostgREST .in() builds a URL-encoded list, and going
// past ~370 hashes blew the URL past fetch's limit ("TypeError: fetch failed").
// Chunk to 100 — comfortably below the limit and only a few round-trips.
const HASH_QUERY_BATCH = 100;
// decryptLabel is one RPC round-trip per node; serial loops would balloon the
// page render to minutes on dense subgraphs.
const DECRYPT_BATCH = 50;

export type GraphNodeDto = {
  hash: string;
  type: NodeType;
  label: GraphNodeLabel;
  maskedPreview: string;
  isPep: boolean;
  hasSanction: boolean;
  inCache: boolean;
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

async function fetchFreshCacheHashes(
  supabase: ServerClient,
  hashes: string[],
  nowIso: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (hashes.length === 0) return out;
  for (let i = 0; i < hashes.length; i += HASH_QUERY_BATCH) {
    const chunk = hashes.slice(i, i + HASH_QUERY_BATCH);
    const { data, error } = await supabase
      .from('predictus_cache')
      .select('document_hash')
      .in('document_hash', chunk)
      .gt('expires_at', nowIso)
      .returns<Array<{ document_hash: string }>>();
    if (error) throw new Error(`fetchFreshCacheHashes failed: ${error.message}`);
    for (const r of data ?? []) out.add(r.document_hash);
  }
  return out;
}

async function rowToDto(
  admin: AdminClient,
  row: NodeRow,
  cacheHashes: Set<string>,
): Promise<GraphNodeDto> {
  let label: GraphNodeLabel = {};
  try {
    const plaintext = await decryptLabel(admin, row.encrypted_label);
    label = JSON.parse(plaintext) as GraphNodeLabel;
  } catch (e) {
    console.warn('label decrypt failed; falling back to masked preview:', e);
  }
  return {
    hash: row.node_hash,
    type: row.node_type,
    label,
    maskedPreview: row.masked_preview,
    isPep: row.is_pep,
    hasSanction: row.has_sanction,
    inCache: row.node_type !== 'lawyer' && cacheHashes.has(row.node_hash),
    lastSeenAt: row.last_seen_at,
  };
}

async function rowsToDtosBatched(
  admin: AdminClient,
  rows: NodeRow[],
  cacheHashes: Set<string>,
): Promise<GraphNodeDto[]> {
  const result: GraphNodeDto[] = [];
  for (let i = 0; i < rows.length; i += DECRYPT_BATCH) {
    const batch = rows.slice(i, i + DECRYPT_BATCH);
    const dtos = await Promise.all(batch.map((r) => rowToDto(admin, r, cacheHashes)));
    result.push(...dtos);
  }
  return result;
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

  const nowIso = new Date().toISOString();
  const hashesToCheckCache = [centerRow.node_hash, ...neighborHashes];
  const cacheHashes = await fetchFreshCacheHashes(supabase, hashesToCheckCache, nowIso);

  const center = await rowToDto(admin, centerRow, cacheHashes);
  const neighbors = await rowsToDtosBatched(admin, neighborRows, cacheHashes);

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

export async function expandNode(
  hash: string,
): Promise<{ subgraph: SubgraphDto; usedPredictus: boolean }> {
  const user = await requirePermission('search_network');
  const admin = createAdminClient();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from('graph_nodes')
    .select('node_hash, node_type, encrypted_label')
    .eq('node_hash', hash)
    .maybeSingle()
    .returns<{ node_hash: string; node_type: NodeType; encrypted_label: string }>();

  if (!row) {
    const subgraph = await getSubgraph(hash);
    return { subgraph, usedPredictus: false };
  }

  // Lawyers cannot be expanded online: Predictus has no search-by-OAB endpoint.
  if (row.node_type === 'lawyer') {
    const subgraph = await getSubgraph(hash);
    return { subgraph, usedPredictus: false };
  }

  const nowIso = new Date().toISOString();
  const { data: cacheRow } = await supabase
    .from('predictus_cache')
    .select('document_hash')
    .eq('document_hash', hash)
    .gt('expires_at', nowIso)
    .maybeSingle()
    .returns<{ document_hash: string }>();

  if (cacheRow) {
    const subgraph = await getSubgraph(hash);
    return { subgraph, usedPredictus: false };
  }

  // Need to call Predictus: decrypt the label to recover the raw document.
  const plaintext = await decryptLabel(admin, row.encrypted_label);
  const label = JSON.parse(plaintext) as GraphNodeLabel;
  if (!label.document) {
    const subgraph = await getSubgraph(hash);
    return { subgraph, usedPredictus: false };
  }

  const requestContext = extractRequestContext(await headers());
  await writeAuditLog(
    {
      userId: user.id,
      action: 'expand_network_node',
      documentHash: hash,
      metadata: { used_predictus: true, expanded_hash: hash },
      ip: requestContext.ip,
      userAgent: requestContext.userAgent,
    },
    admin,
    { allowFailure: true },
  );

  const client = await createServerPredictusClient();
  const results =
    row.node_type === 'cpf'
      ? await client.searchByCpf(label.document)
      : await client.searchByCnpj(label.document);

  await setCachedResults(admin, hash, row.node_type, results);

  const subgraph = await getSubgraph(hash);
  return { subgraph, usedPredictus: true };
}

export async function navigateToNetwork(formData: FormData): Promise<void> {
  await requirePermission('search_network');
  const value = String(formData.get('q') ?? '').trim();
  if (isCpfValid(value)) {
    redirect(`/network/${encodeURIComponent(hashDocument('cpf', value))}`);
  }
  if (isCnpjValid(value)) {
    redirect(`/network/${encodeURIComponent(hashDocument('cnpj', value))}`);
  }
  // Stay on the same page; the header re-renders. We just no-op for invalid input.
  redirect(`/network/_invalid?q=${encodeURIComponent(value)}`);
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
  const nowIso = new Date().toISOString();
  const cacheHashes = await fetchFreshCacheHashes(supabase, path.nodes, nowIso);

  // Preserva a ordem do caminho; ignora hashes sem nó (não deveria ocorrer).
  const ordered = path.nodes.map((h) => byHash.get(h)).filter((r): r is NodeRow => r !== undefined);
  const nodes = await rowsToDtosBatched(admin, ordered, cacheHashes);

  return { found: true, nodes, hops: path.hops };
}
