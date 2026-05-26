import type { Database } from '@/lib/supabase/types.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptLabel } from './label-crypto.ts';
import type { ExtractedEdge, ExtractedNode } from './types.ts';

// How many encrypt_graph_label RPCs to fire in parallel. Each call is a
// network round-trip to PostgREST; sequential iteration was the difference
// between a sub-second upsert and a 4-minute timeout on a 700-node payload
// (which is enough to fail any serverless function quota).
const ENCRYPT_BATCH_SIZE = 50;

function hexCiphertextToBase64(hex: string): string {
  // Supabase returns bytea as the prefixed-hex string '\x<HEX>'. Strip the
  // prefix and re-encode as base64 for the upsert_graph RPC, which decodes
  // base64 internally.
  const cleaned = hex.startsWith('\\x') ? hex.slice(2) : hex;
  return Buffer.from(cleaned, 'hex').toString('base64');
}

type NodeIn = {
  node_hash: string;
  node_type: string;
  encrypted_label_b64: string;
  masked_preview: string;
};

async function encryptNodesBatched(
  client: SupabaseClient<Database>,
  nodes: ExtractedNode[],
): Promise<NodeIn[]> {
  const result: NodeIn[] = [];
  for (let i = 0; i < nodes.length; i += ENCRYPT_BATCH_SIZE) {
    const batch = nodes.slice(i, i + ENCRYPT_BATCH_SIZE);
    const encrypted = await Promise.all(
      batch.map(async (node) => {
        const hexCipher = await encryptLabel(client, JSON.stringify(node.label));
        return {
          node_hash: node.nodeHash,
          node_type: node.nodeType,
          encrypted_label_b64: hexCiphertextToBase64(hexCipher),
          masked_preview: node.maskedPreview,
        };
      }),
    );
    result.push(...encrypted);
  }
  return result;
}

export async function upsertGraph(
  client: SupabaseClient<Database>,
  nodes: ExtractedNode[],
  edges: ExtractedEdge[],
): Promise<void> {
  if (nodes.length === 0 && edges.length === 0) return;

  const nodes_in = await encryptNodesBatched(client, nodes);

  const edges_in = edges.map((e) => {
    if (e.kind === 'corporate_relation') {
      return {
        source_hash: e.sourceHash,
        target_hash: e.targetHash,
        kind: e.kind,
        evidence: e.evidence,
      };
    }
    return {
      source_hash: e.sourceHash,
      target_hash: e.targetHash,
      kind: e.kind,
      process_number: e.evidence.processNumber,
      same_polo: e.evidence.samePolo,
    };
  });

  const { error } = await client.rpc('upsert_graph' as never, { nodes_in, edges_in } as never);
  if (error) throw new Error(`upsertGraph failed: ${error.message}`);
}
