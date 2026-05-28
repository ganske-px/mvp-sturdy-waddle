import { describe, expect, it } from 'vitest';
import { deriveSubgraphStats } from './subgraph-stats';

describe('deriveSubgraphStats', () => {
  it('counts neighbors by type and edges by kind, ignoring the center', () => {
    const stats = deriveSubgraphStats(
      'CENTER',
      [
        { node_hash: 'CENTER', node_type: 'cpf' },
        { node_hash: 'A', node_type: 'cpf' },
        { node_hash: 'B', node_type: 'cnpj' },
        { node_hash: 'A', node_type: 'cpf' }, // duplicate neighbor
        { node_hash: 'L', node_type: 'lawyer' },
      ],
      [
        { kind: 'family_relation' },
        { kind: 'corporate_relation' },
        { kind: 'co_party' },
        { kind: 'client_lawyer' },
        { kind: 'lawyer_lawyer' },
      ],
    );
    expect(stats).toEqual({
      nodes: 3, // A, B, L (CENTER excluded, A deduped)
      edges: 5,
      people: 1, // A
      companies: 1, // B
      familyEdges: 1,
      corporateEdges: 1,
      processEdges: 3, // co_party + client_lawyer + lawyer_lawyer
    });
  });

  it('returns all-zero stats for an empty subgraph', () => {
    expect(deriveSubgraphStats('CENTER', [], [])).toEqual({
      nodes: 0,
      edges: 0,
      people: 0,
      companies: 0,
      familyEdges: 0,
      corporateEdges: 0,
      processEdges: 0,
    });
  });
});
