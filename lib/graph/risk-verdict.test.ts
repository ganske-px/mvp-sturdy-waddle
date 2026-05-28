import { describe, expect, it, vi } from 'vitest';

type RiskyRow = { node_hash: string; is_pep: boolean; has_sanction: boolean };
type EdgeRow = { source_hash: string; target_hash: string };

// Build a Supabase server-client mock whose chained query builder mirrors the
// two calls getRiskVerdict makes, in order:
//   .from('graph_nodes').select(...).or(...).returns()  -> risky nodes
//   .from('graph_edges').select(...).returns()          -> all edges
// Each `from(table)` returns a builder whose terminal `.returns()` resolves the
// configured rows for that table. `.select` / `.or` are pass-through.
function buildSupabaseMock({
  riskyRows,
  edgeRows,
}: {
  riskyRows: RiskyRow[];
  edgeRows: EdgeRow[];
}) {
  return {
    from(table: string) {
      const data = table === 'graph_nodes' ? riskyRows : table === 'graph_edges' ? edgeRows : null;
      const builder = {
        select: () => builder,
        or: () => builder,
        returns: () => Promise.resolve({ data, error: null }),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { getRiskVerdict } from './risk-verdict';

const mocked = vi.mocked(createClient);

describe('getRiskVerdict', () => {
  it('returns NO_RISK when there are no risky nodes', async () => {
    mocked.mockResolvedValueOnce(buildSupabaseMock({ riskyRows: [], edgeRows: [] }) as never);
    expect(await getRiskVerdict('CENTER')).toEqual({
      level: 'none',
      distance: 0,
      targetHash: null,
      isPep: false,
      hasSanction: false,
    });
  });

  it('flags direct risk (1 hop) and surfaces the target flags', async () => {
    mocked.mockResolvedValueOnce(
      buildSupabaseMock({
        riskyRows: [{ node_hash: 'A', is_pep: true, has_sanction: false }],
        edgeRows: [{ source_hash: 'CENTER', target_hash: 'A' }],
      }) as never,
    );
    expect(await getRiskVerdict('CENTER')).toEqual({
      level: 'direct',
      distance: 1,
      targetHash: 'A',
      isPep: true,
      hasSanction: false,
    });
  });

  it('flags nearby risk (2 hops)', async () => {
    mocked.mockResolvedValueOnce(
      buildSupabaseMock({
        riskyRows: [{ node_hash: 'B', is_pep: false, has_sanction: true }],
        edgeRows: [
          { source_hash: 'CENTER', target_hash: 'M' },
          { source_hash: 'M', target_hash: 'B' },
        ],
      }) as never,
    );
    expect(await getRiskVerdict('CENTER')).toEqual({
      level: 'nearby',
      distance: 2,
      targetHash: 'B',
      isPep: false,
      hasSanction: true,
    });
  });

  it('returns NO_RISK when the only risky node is beyond RISK_MAX_HOPS', async () => {
    // CENTER -> 1 -> 2 -> 3 -> FAR : FAR is 4 hops away, RISK_MAX_HOPS is 3.
    mocked.mockResolvedValueOnce(
      buildSupabaseMock({
        riskyRows: [{ node_hash: 'FAR', is_pep: true, has_sanction: true }],
        edgeRows: [
          { source_hash: 'CENTER', target_hash: '1' },
          { source_hash: '1', target_hash: '2' },
          { source_hash: '2', target_hash: '3' },
          { source_hash: '3', target_hash: 'FAR' },
        ],
      }) as never,
    );
    expect(await getRiskVerdict('CENTER')).toEqual({
      level: 'none',
      distance: 0,
      targetHash: null,
      isPep: false,
      hasSanction: false,
    });
  });
});
