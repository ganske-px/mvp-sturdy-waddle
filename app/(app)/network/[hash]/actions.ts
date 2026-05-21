'use server';

import { extractRequestContext, writeAuditLog } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/permissions';
import { decryptLabel } from '@/lib/graph/label-crypto';
import type { EdgeKind, GraphNodeLabel, NodeType, StoredEdgeEvidence } from '@/lib/graph/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';

export type GraphNodeDto = {
  hash: string;
  type: NodeType;
  label: GraphNodeLabel;
  maskedPreview: string;
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
    inCache: row.node_type !== 'lawyer' && cacheHashes.has(row.node_hash),
    lastSeenAt: row.last_seen_at,
  };
}

export async function getSubgraph(centerHash: string): Promise<SubgraphDto> {
  const user = await requirePermission('search_network');
  const admin = createAdminClient();
  const supabase = await createClient();

  const { data: centerRow } = await supabase
    .from('graph_nodes')
    .select('node_hash, node_type, encrypted_label, masked_preview, last_seen_at')
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

  const { data: neighborRows } =
    neighborHashes.length === 0
      ? { data: [] as NodeRow[] }
      : await supabase
          .from('graph_nodes')
          .select('node_hash, node_type, encrypted_label, masked_preview, last_seen_at')
          .in('node_hash', neighborHashes)
          .returns<NodeRow[]>();

  const hashesToCheckCache = [centerRow.node_hash, ...neighborHashes].filter(
    (h) => !h.startsWith('lawyer:'),
  );
  const nowIso = new Date().toISOString();
  const { data: cacheRows } =
    hashesToCheckCache.length === 0
      ? { data: [] as Array<{ document_hash: string }> }
      : await supabase
          .from('predictus_cache')
          .select('document_hash')
          .in('document_hash', hashesToCheckCache)
          .gt('expires_at', nowIso)
          .returns<Array<{ document_hash: string }>>();
  const cacheHashes = new Set((cacheRows ?? []).map((r) => r.document_hash));

  const center = await rowToDto(admin, centerRow, cacheHashes);
  const neighbors = await Promise.all(
    (neighborRows ?? []).map((r) => rowToDto(admin, r, cacheHashes)),
  );

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
