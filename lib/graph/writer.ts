import type { Database } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptLabel } from './label-crypto';
import type { ExtractedEdge, ExtractedNode } from './types';

function hexCiphertextToBase64(hex: string): string {
  // Supabase returns bytea as the prefixed-hex string '\x<HEX>'. Strip the
  // prefix and re-encode as base64 for the upsert_graph RPC, which decodes
  // base64 internally.
  const cleaned = hex.startsWith('\\x') ? hex.slice(2) : hex;
  return Buffer.from(cleaned, 'hex').toString('base64');
}

export async function upsertGraph(
  client: SupabaseClient<Database>,
  nodes: ExtractedNode[],
  edges: ExtractedEdge[],
): Promise<void> {
  if (nodes.length === 0 && edges.length === 0) return;

  const nodes_in: Array<Record<string, string>> = [];
  for (const node of nodes) {
    const hexCipher = await encryptLabel(client, JSON.stringify(node.label));
    nodes_in.push({
      node_hash: node.nodeHash,
      node_type: node.nodeType,
      encrypted_label_b64: hexCiphertextToBase64(hexCipher),
      masked_preview: node.maskedPreview,
    });
  }

  const edges_in = edges.map((e) => ({
    source_hash: e.sourceHash,
    target_hash: e.targetHash,
    kind: e.kind,
    process_number: e.evidence.processNumber,
    same_polo: e.evidence.samePolo,
  }));

  const { error } = await client.rpc('upsert_graph' as never, { nodes_in, edges_in } as never);
  if (error) throw new Error(`upsertGraph failed: ${error.message}`);
}
