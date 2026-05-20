import { afterEach, describe, expect, it, vi } from 'vitest';
import { PredictusClient } from './client';
import { PredictusError } from './types';

type FetchCall = { url: string; init: RequestInit };

function buildFetch(
  responses: Array<Response | (() => Response | Promise<Response>) | Error>,
) {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = responses[i++];
    if (next === undefined) {
      throw new Error(`Unexpected extra fetch call (#${i}) to ${String(input)}`);
    }
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return await next();
    return next;
  });
  return { fetchMock, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

function buildClient(overrides: Partial<ConstructorParameters<typeof PredictusClient>[0]> = {}) {
  const sleep = vi.fn().mockResolvedValue(undefined);
  return {
    sleep,
    client: new PredictusClient({
      baseUrl: 'https://api.predictus.test',
      username: 'user',
      password: 'pass',
      sleep,
      ...overrides,
    }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('PredictusClient.authenticate', () => {
  it('POSTs credentials and returns the access token', async () => {
    const { fetchMock, calls } = buildFetch([jsonResponse({ accessToken: 'tok-1' })]);
    const { client } = buildClient({ fetch: fetchMock });

    const token = await client.authenticate();

    expect(token).toBe('tok-1');
    expect(calls[0]?.url).toBe('https://api.predictus.test/auth');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      username: 'user',
      password: 'pass',
    });
  });

  it('throws when the auth response omits accessToken', async () => {
    const { fetchMock } = buildFetch([jsonResponse({})]);
    const { client } = buildClient({ fetch: fetchMock });
    await expect(client.authenticate()).rejects.toBeInstanceOf(PredictusError);
  });

  it('throws when auth status is non-2xx', async () => {
    const { fetchMock } = buildFetch([jsonResponse({ error: 'bad creds' }, 401)]);
    const { client } = buildClient({ fetch: fetchMock });
    await expect(client.authenticate()).rejects.toBeInstanceOf(PredictusError);
  });
});

describe('PredictusClient.searchByCpf — happy paths', () => {
  it('authenticates lazily on the first call and returns results', async () => {
    const { fetchMock, calls } = buildFetch([
      jsonResponse({ accessToken: 'tok-1' }),
      jsonResponse([{ numeroProcessoUnico: '0001' }]),
    ]);
    const { client } = buildClient({ fetch: fetchMock });

    const result = await client.searchByCpf('11144477735');

    expect(result).toEqual([{ numeroProcessoUnico: '0001' }]);
    expect(calls[0]?.url).toBe('https://api.predictus.test/auth');
    expect(calls[1]?.url).toBe(
      'https://api.predictus.test/predictus-api/processos/judiciais/buscarPorCPFParte',
    );
    expect(JSON.parse(calls[1]?.init?.body as string)).toEqual({ cpf: '11144477735' });
    expect((calls[1]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('treats 204 No Content as empty results (nada consta)', async () => {
    const { fetchMock } = buildFetch([
      jsonResponse({ accessToken: 'tok-1' }),
      emptyResponse(204),
    ]);
    const { client } = buildClient({ fetch: fetchMock });
    expect(await client.searchByCpf('11144477735')).toEqual([]);
  });

  it('treats a 200 with empty body as empty results', async () => {
    const { fetchMock } = buildFetch([
      jsonResponse({ accessToken: 'tok-1' }),
      new Response('', { status: 200 }),
    ]);
    const { client } = buildClient({ fetch: fetchMock });
    expect(await client.searchByCpf('11144477735')).toEqual([]);
  });
});

describe('PredictusClient — token refresh on 401', () => {
  it('re-authenticates and retries once when receiving a 401', async () => {
    const { fetchMock, calls } = buildFetch([
      jsonResponse({ accessToken: 'tok-stale' }), // first auth
      emptyResponse(401), // search with stale token
      jsonResponse({ accessToken: 'tok-fresh' }), // re-auth
      jsonResponse([{ numeroProcessoUnico: '0001' }]), // retry succeeds
    ]);
    const { client } = buildClient({ fetch: fetchMock });

    const result = await client.searchByCpf('11144477735');

    expect(result).toEqual([{ numeroProcessoUnico: '0001' }]);
    expect(calls).toHaveLength(4);
    expect((calls[3]?.init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok-fresh',
    );
  });

  it('does not re-authenticate twice in a row on persistent 401', async () => {
    const { fetchMock } = buildFetch([
      jsonResponse({ accessToken: 'tok-1' }),
      emptyResponse(401),
      jsonResponse({ accessToken: 'tok-2' }),
      emptyResponse(401),
    ]);
    const { client } = buildClient({ fetch: fetchMock });
    await expect(client.searchByCpf('11144477735')).rejects.toBeInstanceOf(PredictusError);
  });
});

describe('PredictusClient — retries on 5xx', () => {
  it('retries up to 3 times with exponential backoff and succeeds', async () => {
    const { fetchMock } = buildFetch([
      jsonResponse({ accessToken: 'tok-1' }),
      jsonResponse({ error: 'oops' }, 500),
      jsonResponse({ error: 'oops' }, 502),
      jsonResponse([{ numeroProcessoUnico: '0001' }]),
    ]);
    const { sleep, client } = buildClient({ fetch: fetchMock });

    const result = await client.searchByCpf('11144477735');

    expect(result).toEqual([{ numeroProcessoUnico: '0001' }]);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it('throws after exhausting maxRetries', async () => {
    const { fetchMock } = buildFetch([
      jsonResponse({ accessToken: 'tok-1' }),
      jsonResponse({ error: 'oops' }, 500),
      jsonResponse({ error: 'oops' }, 500),
      jsonResponse({ error: 'oops' }, 500),
      jsonResponse({ error: 'oops' }, 500),
    ]);
    const { sleep, client } = buildClient({ fetch: fetchMock });

    await expect(client.searchByCpf('11144477735')).rejects.toBeInstanceOf(PredictusError);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(3, 4000);
  });

  it('retries on network errors (fetch rejects)', async () => {
    const { fetchMock } = buildFetch([
      jsonResponse({ accessToken: 'tok-1' }),
      new Error('ECONNRESET'),
      jsonResponse([{ numeroProcessoUnico: '0001' }]),
    ]);
    const { sleep, client } = buildClient({ fetch: fetchMock });

    const result = await client.searchByCpf('11144477735');
    expect(result).toEqual([{ numeroProcessoUnico: '0001' }]);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

describe('PredictusClient — non-retryable 4xx', () => {
  it('does not retry on 400', async () => {
    const { fetchMock } = buildFetch([
      jsonResponse({ accessToken: 'tok-1' }),
      jsonResponse({ error: 'bad request' }, 400),
    ]);
    const { sleep, client } = buildClient({ fetch: fetchMock });
    await expect(client.searchByCpf('11144477735')).rejects.toBeInstanceOf(PredictusError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry on 403', async () => {
    const { fetchMock } = buildFetch([
      jsonResponse({ accessToken: 'tok-1' }),
      jsonResponse({ error: 'forbidden' }, 403),
    ]);
    const { sleep, client } = buildClient({ fetch: fetchMock });
    await expect(client.searchByCpf('11144477735')).rejects.toBeInstanceOf(PredictusError);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('PredictusClient — endpoint routing', () => {
  it('searchByCnpj hits the CNPJ endpoint with the expected payload', async () => {
    const { fetchMock, calls } = buildFetch([
      jsonResponse({ accessToken: 'tok-1' }),
      jsonResponse([]),
    ]);
    const { client } = buildClient({ fetch: fetchMock });
    await client.searchByCnpj('11222333000181');
    expect(calls[1]?.url).toBe(
      'https://api.predictus.test/predictus-api/processos/judiciais/buscarPorCNPJParte',
    );
    expect(JSON.parse(calls[1]?.init?.body as string)).toEqual({ cnpj: '11222333000181' });
  });

  it('searchByName uppercases the name and hits the name endpoint', async () => {
    const { fetchMock, calls } = buildFetch([
      jsonResponse({ accessToken: 'tok-1' }),
      jsonResponse([]),
    ]);
    const { client } = buildClient({ fetch: fetchMock });
    await client.searchByName('João Silva');
    expect(calls[1]?.url).toBe(
      'https://api.predictus.test/predictus-api/processos/judiciais/buscarPorNomeParte',
    );
    expect(JSON.parse(calls[1]?.init?.body as string)).toEqual({ nome: 'JOÃO SILVA' });
  });
});
