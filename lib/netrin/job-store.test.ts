import { describe, expect, it } from 'vitest';
import { findOrCreateJob } from './job-store';

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
    const result = await findOrCreateJob(client, { userId: 'u1', rootHash: 'cpf:abc', rootType: 'cpf' });
    expect(result).toEqual({ jobId: 'j-existing', created: false });
  });

  it('inserts a new pending job when none active', async () => {
    const client = clientWith(
      { data: null, error: null },
      { data: { id: 'j-new' }, error: null },
    );
    const result = await findOrCreateJob(client, { userId: 'u1', rootHash: 'cpf:abc', rootType: 'cpf' });
    expect(result).toEqual({ jobId: 'j-new', created: true });
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
                return { single: () => Promise.resolve({ data: null, error: { message: 'duplicate', code: '23505' } }) };
              },
            };
          },
        };
      },
    } as never;

    const result = await findOrCreateJob(client, { userId: 'u1', rootHash: 'cpf:abc', rootType: 'cpf' });
    expect(result).toEqual({ jobId: 'j-winner', created: false });
  });
});
