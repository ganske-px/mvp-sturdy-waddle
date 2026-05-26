import { describe, expect, it } from 'vitest';
import {
  bumpHopDone,
  findOrCreateJob,
  recordCall,
  setHopTotals,
  setJobStatus,
  setNetrinStatus,
} from './job-store';

function clientWith(
  selectMaybeSingle: { data: unknown; error: { message: string } | null },
  insertResult: { data: unknown; error: { message: string; code?: string } | null },
) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                in() {
                  return {
                    maybeSingle() {
                      return Promise.resolve(selectMaybeSingle);
                    },
                  };
                },
              };
            },
          };
        },
        insert() {
          return {
            select() {
              return { single: () => Promise.resolve(insertResult) };
            },
          };
        },
      };
    },
  } as never;
}

describe('findOrCreateJob', () => {
  it('returns existing job when status pending/running', async () => {
    const client = clientWith(
      { data: { id: 'j-existing', status: 'running' }, error: null },
      { data: null, error: null },
    );
    const result = await findOrCreateJob(client, {
      userId: 'u1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
      documentEncrypted: 'enc(11144477735)',
    });
    expect(result).toEqual({ jobId: 'j-existing', created: false });
  });

  it('inserts a new pending job when none active', async () => {
    const client = clientWith({ data: null, error: null }, { data: { id: 'j-new' }, error: null });
    const result = await findOrCreateJob(client, {
      userId: 'u1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
      documentEncrypted: 'enc(11144477735)',
    });
    expect(result).toEqual({ jobId: 'j-new', created: true });
  });

  it('passes document_encrypted to the insert payload', async () => {
    let insertedRow: Record<string, unknown> | null = null;
    const client = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  in() {
                    return { maybeSingle: () => Promise.resolve({ data: null, error: null }) };
                  },
                };
              },
            };
          },
          insert(row: Record<string, unknown>) {
            insertedRow = row;
            return {
              select() {
                return { single: () => Promise.resolve({ data: { id: 'j-new' }, error: null }) };
              },
            };
          },
        };
      },
    } as never;

    await findOrCreateJob(client, {
      userId: 'u1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
      documentEncrypted: 'enc(11144477735)',
    });

    expect((insertedRow as Record<string, unknown> | null)?.document_encrypted).toBe(
      'enc(11144477735)',
    );
  });

  it('returns existing on unique-violation race', async () => {
    let selectCalls = 0;
    const client = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  in() {
                    return {
                      maybeSingle() {
                        selectCalls++;
                        return Promise.resolve(
                          selectCalls === 1
                            ? { data: null, error: null }
                            : { data: { id: 'j-winner', status: 'running' }, error: null },
                        );
                      },
                    };
                  },
                };
              },
            };
          },
          insert() {
            return {
              select() {
                return {
                  single: () =>
                    Promise.resolve({ data: null, error: { message: 'duplicate', code: '23505' } }),
                };
              },
            };
          },
        };
      },
    } as never;

    const result = await findOrCreateJob(client, {
      userId: 'u1',
      rootHash: 'cpf:abc',
      rootType: 'cpf',
      documentEncrypted: 'enc(11144477735)',
    });
    expect(result).toEqual({ jobId: 'j-winner', created: false });
  });
});

describe('setJobStatus', () => {
  it('updates job status successfully', async () => {
    let updatedPayload: unknown = null;
    let eqId: string | null = null;
    const client = {
      from(table: string) {
        expect(table).toBe('enrichment_jobs');
        return {
          update(payload: unknown) {
            updatedPayload = payload;
            return {
              eq(col: string, val: string) {
                expect(col).toBe('id');
                eqId = val;
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    } as never;

    await setJobStatus(client, 'j-1', 'completed', { error: 'some error', finished: true });
    expect(eqId).toBe('j-1');
    expect(updatedPayload).toEqual({
      status: 'completed',
      error: 'some error',
      finished_at: expect.any(String),
    });
  });

  it('throws when update fails', async () => {
    const client = {
      from() {
        return {
          update() {
            return {
              eq() {
                return Promise.resolve({ error: { message: 'db error' } });
              },
            };
          },
        };
      },
    } as never;

    await expect(setJobStatus(client, 'j-1', 'failed')).rejects.toThrow(
      'setJobStatus failed: db error',
    );
  });
});

describe('setNetrinStatus', () => {
  it('updates hop1_status successfully', async () => {
    let updatedPayload: unknown = null;
    const client = {
      from() {
        return {
          update(payload: unknown) {
            updatedPayload = payload;
            return {
              eq() {
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    } as never;

    await setNetrinStatus(client, 'j-1', 'success');
    expect(updatedPayload).toEqual({ hop1_status: 'success' });
  });

  it('throws on error', async () => {
    const client = {
      from() {
        return {
          update() {
            return {
              eq() {
                return Promise.resolve({ error: { message: 'err' } });
              },
            };
          },
        };
      },
    } as never;
    await expect(setNetrinStatus(client, 'j-1', 'error')).rejects.toThrow(
      'setNetrinStatus failed: err',
    );
  });
});

describe('setHopTotals', () => {
  it('updates hop totals successfully', async () => {
    let updatedPayload: unknown = null;
    const client = {
      from() {
        return {
          update(payload: unknown) {
            updatedPayload = payload;
            return {
              eq() {
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    } as never;

    await setHopTotals(client, 'j-1', { hop2_total: 5, hop3_total: 10 });
    expect(updatedPayload).toEqual({ hop2_total: 5, hop3_total: 10 });
  });

  it('throws on error', async () => {
    const client = {
      from() {
        return {
          update() {
            return {
              eq() {
                return Promise.resolve({ error: { message: 'err' } });
              },
            };
          },
        };
      },
    } as never;
    await expect(setHopTotals(client, 'j-1', {})).rejects.toThrow('setHopTotals failed: err');
  });
});

describe('bumpHopDone', () => {
  it('increments hop done column successfully', async () => {
    let updatedPayload: unknown = null;
    const client = {
      from() {
        return {
          select(col: string) {
            expect(col).toBe('hop2_done');
            return {
              eq(eqCol: string, eqVal: string) {
                expect(eqCol).toBe('id');
                expect(eqVal).toBe('j-1');
                return {
                  single() {
                    return Promise.resolve({ data: { hop2_done: 2 }, error: null });
                  },
                };
              },
            };
          },
          update(payload: unknown) {
            updatedPayload = payload;
            return {
              eq() {
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    } as never;

    await bumpHopDone(client, 'j-1', 2);
    expect(updatedPayload).toEqual({ hop2_done: 3 });
  });

  it('throws when select fails', async () => {
    const client = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  single() {
                    return Promise.resolve({ data: null, error: { message: 'not found' } });
                  },
                };
              },
            };
          },
        };
      },
    } as never;
    await expect(bumpHopDone(client, 'j-1', 3)).rejects.toThrow('bumpHopDone select: not found');
  });

  it('throws when update fails', async () => {
    const client = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  single() {
                    return Promise.resolve({ data: { hop3_done: 0 }, error: null });
                  },
                };
              },
            };
          },
          update() {
            return {
              eq() {
                return Promise.resolve({ error: { message: 'upd err' } });
              },
            };
          },
        };
      },
    } as never;
    await expect(bumpHopDone(client, 'j-1', 3)).rejects.toThrow('bumpHopDone update: upd err');
  });
});

describe('recordCall', () => {
  it('inserts call record successfully', async () => {
    let insertedRow: unknown = null;
    const client = {
      from(table: string) {
        expect(table).toBe('enrichment_job_calls');
        return {
          insert(row: unknown) {
            insertedRow = row;
            return Promise.resolve({ error: null });
          },
        };
      },
    } as never;

    await recordCall(client, {
      jobId: 'j-1',
      hop: 1,
      documentHash: 'h-1',
      documentType: 'cpf',
      slugs: ['slug1'],
      status: 'success',
      cached: false,
      error: 'none',
    });

    expect(insertedRow).toEqual({
      job_id: 'j-1',
      hop: 1,
      document_hash: 'h-1',
      document_type: 'cpf',
      slugs: ['slug1'],
      status: 'success',
      cached: false,
      fetched_at: expect.any(String),
      error: 'none',
    });
  });

  it('throws on error', async () => {
    const client = {
      from() {
        return {
          insert() {
            return Promise.resolve({ error: { message: 'ins err' } });
          },
        };
      },
    } as never;
    await expect(
      recordCall(client, {
        jobId: 'j-1',
        hop: 2,
        documentHash: 'h-2',
        documentType: 'cnpj',
        slugs: [],
        status: 'error',
        cached: false,
      }),
    ).rejects.toThrow('recordCall failed: ins err');
  });
});
