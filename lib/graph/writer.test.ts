import { describe, expect, it } from 'vitest';
import type { ExtractedEdge, ExtractedNode } from './types';
import { upsertGraph } from './writer';

type RpcCall = { name: string; params: unknown };

function buildFakeClient(opts: { encryptError?: string; upsertError?: string } = {}) {
  const calls: RpcCall[] = [];
  const client = {
    rpc(name: string, params: Record<string, unknown>) {
      calls.push({ name, params });
      if (name === 'encrypt_graph_label') {
        if (opts.encryptError) {
          return Promise.resolve({ data: null, error: { message: opts.encryptError } });
        }
        // Pretend the RPC returns a hex-encoded ciphertext of the plaintext bytes.
        const hex = Buffer.from(String(params.plaintext), 'utf8').toString('hex');
        return Promise.resolve({ data: `\\x${hex}`, error: null });
      }
      if (name === 'upsert_graph') {
        if (opts.upsertError) {
          return Promise.resolve({ data: null, error: { message: opts.upsertError } });
        }
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`unexpected rpc: ${name}`);
    },
  };
  return { client, calls };
}

const NODE_A: ExtractedNode = {
  nodeHash: 'cpf:a',
  nodeType: 'cpf',
  label: { name: 'Alice', document: '11144477735' },
  maskedPreview: 'Alice — ***',
};

const NODE_B: ExtractedNode = {
  nodeHash: 'cpf:b',
  nodeType: 'cpf',
  label: { name: 'Beto', document: '52998224725' },
  maskedPreview: 'Beto — ***',
};

const EDGE: ExtractedEdge = {
  sourceHash: 'cpf:a',
  targetHash: 'cpf:b',
  kind: 'co_party',
  evidence: { processNumber: 'P-1', samePolo: false },
};

describe('upsertGraph', () => {
  it('encrypts every node label then calls upsert_graph once', async () => {
    const { client, calls } = buildFakeClient();
    await upsertGraph(client as never, [NODE_A, NODE_B], [EDGE]);

    const encryptCalls = calls.filter((c) => c.name === 'encrypt_graph_label');
    expect(encryptCalls).toHaveLength(2);
    expect(encryptCalls[0]?.params).toEqual({ plaintext: JSON.stringify(NODE_A.label) });

    const upsertCalls = calls.filter((c) => c.name === 'upsert_graph');
    expect(upsertCalls).toHaveLength(1);
    const params = upsertCalls[0]?.params as { nodes_in: unknown[]; edges_in: unknown[] };
    expect(Array.isArray(params.nodes_in)).toBe(true);
    expect(Array.isArray(params.edges_in)).toBe(true);
    expect(params.nodes_in).toHaveLength(2);
    expect(params.edges_in).toHaveLength(1);
    expect((params.nodes_in[0] as { node_hash: string }).node_hash).toBe('cpf:a');
    expect((params.nodes_in[0] as { encrypted_label_b64: string }).encrypted_label_b64).toMatch(
      /^[A-Za-z0-9+/=]+$/,
    );
  });

  it('does nothing when both arrays are empty', async () => {
    const { client, calls } = buildFakeClient();
    await upsertGraph(client as never, [], []);
    expect(calls).toEqual([]);
  });

  it('throws when label encryption fails', async () => {
    const { client } = buildFakeClient({ encryptError: 'vault' });
    await expect(upsertGraph(client as never, [NODE_A], [])).rejects.toThrow(/vault/);
  });

  it('throws when upsert_graph fails', async () => {
    const { client } = buildFakeClient({ upsertError: 'rls denied' });
    await expect(upsertGraph(client as never, [NODE_A], [])).rejects.toThrow(/rls denied/);
  });

  it('forwards is_pep and has_sanction when node.risk is set', async () => {
    const { client, calls } = buildFakeClient();
    const riskNode: ExtractedNode = {
      nodeHash: 'h1',
      nodeType: 'cpf',
      label: { document: '123' },
      maskedPreview: 'm',
      risk: { isPep: true, hasSanction: false },
    };
    await upsertGraph(client as never, [riskNode], []);
    const rpc = {
      mock: {
        calls: calls.filter((c) => c.name === 'upsert_graph').map((c) => [c.name, c.params]),
      },
    };
    const arg = rpc.mock.calls[0]?.[1] as { nodes_in: Array<Record<string, unknown>> };
    expect(arg.nodes_in[0]).toMatchObject({ is_pep: true, has_sanction: false });
  });

  it('forwards same_polo and process_number on each edge', async () => {
    const { client, calls } = buildFakeClient();
    await upsertGraph(
      client as never,
      [NODE_A, NODE_B],
      [EDGE, { ...EDGE, evidence: { processNumber: 'P-2', samePolo: null } }],
    );
    const upsert = calls.find((c) => c.name === 'upsert_graph');
    const params = upsert?.params as { edges_in: Array<Record<string, unknown>> };
    expect(params.edges_in[0]).toMatchObject({
      source_hash: 'cpf:a',
      target_hash: 'cpf:b',
      kind: 'co_party',
      process_number: 'P-1',
      same_polo: false,
    });
    expect(params.edges_in[1]).toMatchObject({
      process_number: 'P-2',
      same_polo: null,
    });
  });
});
