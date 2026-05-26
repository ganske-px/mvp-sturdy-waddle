// lib/netrin/client.test.ts
import { describe, expect, it, vi } from 'vitest';
import { NetrinClient } from './client';
import { HOP1_SLUGS, NetrinError } from './types';

function makeFetch(handler: (url: string) => Promise<Response> | Response) {
  return vi.fn(async (url: string | URL) => handler(url.toString()));
}

describe('NetrinClient.fetchComposta', () => {
  it('builds the URL with token, document and multiple s= params', async () => {
    let capturedUrl = '';
    const fetchImpl = makeFetch((url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ 'esp-cpf': { ok: true } }), { status: 200 });
    });
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await client.fetchComposta('cpf', '12345678909', ['esp-cpf', 'pep-kyc-cpf']);

    expect(capturedUrl).toContain('https://api.netrin.com.br/v1/consulta-composta?');
    expect(capturedUrl).toContain('token=TKN');
    expect(capturedUrl).toContain('cpf=12345678909');
    expect(capturedUrl).toMatch(/s=esp-cpf/);
    expect(capturedUrl).toMatch(/s=pep-kyc-cpf/);
  });

  it('routes cnpj documents with cnpj= query param', async () => {
    let capturedUrl = '';
    const fetchImpl = makeFetch((url) => {
      capturedUrl = url;
      return new Response('{}', { status: 200 });
    });
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await client.fetchComposta('cnpj', '12345678000199', ['esp-cnpj-completo']);

    expect(capturedUrl).toContain('cnpj=12345678000199');
    expect(capturedUrl).not.toContain('cpf=');
  });

  it('appends acuracia when pep-kyc-* is in the slug set', async () => {
    let capturedUrl = '';
    const fetchImpl = makeFetch((url) => {
      capturedUrl = url;
      return new Response('{}', { status: 200 });
    });
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      pepAcuracia: 90,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await client.fetchComposta('cpf', '12345678909', ['pep-kyc-cpf']);

    expect(capturedUrl).toContain('acuracia=90');
  });

  it('retries 5xx with exponential backoff and surfaces success', async () => {
    let attempt = 0;
    const fetchImpl = makeFetch(() => {
      attempt++;
      if (attempt < 3) return new Response('upstream', { status: 502 });
      return new Response(JSON.stringify({ 'esp-cpf': { ok: true } }), { status: 200 });
    });
    const sleepCalls: number[] = [];
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      fetch: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
      initialBackoffMs: 10,
    });

    const result = await client.fetchComposta('cpf', '12345678909', ['esp-cpf']);

    expect(attempt).toBe(3);
    expect(sleepCalls).toEqual([10, 20]);
    expect(result['esp-cpf']).toEqual({ ok: true });
  });

  it('throws NetrinError after maxRetries 5xx failures', async () => {
    const fetchImpl = makeFetch(() => new Response('boom', { status: 503 }));
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      fetch: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      maxRetries: 2,
      initialBackoffMs: 1,
    });

    await expect(client.fetchComposta('cpf', '12345678909', ['esp-cpf'])).rejects.toBeInstanceOf(
      NetrinError,
    );
  });

  it('throws immediately on 401', async () => {
    const fetchImpl = makeFetch(() => new Response('nope', { status: 401 }));
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.fetchComposta('cpf', '12345678909', ['esp-cpf'])).rejects.toMatchObject({
      name: 'NetrinError',
      status: 401,
    });
  });

  it('never leaks the token in error messages', async () => {
    const fetchImpl = makeFetch(() => new Response('nope', { status: 401 }));
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'SUPER-SECRET-TKN',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    let err: Error | undefined;
    try {
      await client.fetchComposta('cpf', '12345678909', ['esp-cpf']);
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message ?? '').not.toContain('SUPER-SECRET-TKN');
  });

  it('typechecks against the full HOP1 slug list', async () => {
    const fetchImpl = makeFetch(() => new Response('{}', { status: 200 }));
    const client = new NetrinClient({
      baseUrl: 'https://api.netrin.com.br',
      token: 'TKN',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      client.fetchComposta('cpf', '12345678909', [...HOP1_SLUGS]),
    ).resolves.toBeDefined();
  });
});
