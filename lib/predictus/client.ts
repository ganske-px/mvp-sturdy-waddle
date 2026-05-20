import { type PredictusClientConfig, PredictusError, type PredictusSearchResult } from './types';

const AUTH_PATH = '/auth';
const ENDPOINTS = {
  cpf: '/predictus-api/processos/judiciais/buscarPorCPFParte',
  cnpj: '/predictus-api/processos/judiciais/buscarPorCNPJParte',
  name: '/predictus-api/processos/judiciais/buscarPorNomeParte',
} as const;

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

type SearchPayload = { cpf: string } | { cnpj: string } | { nome: string };

export class PredictusClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly onTokenChange?: (token: string) => Promise<void> | void;
  private token: string | null = null;

  constructor(config: PredictusClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.username = config.username;
    this.password = config.password;
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = config.sleep ?? defaultSleep;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialBackoffMs = config.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.onTokenChange = config.onTokenChange;
    this.token = config.initialToken ?? null;
  }

  async authenticate(): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}${AUTH_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });

    if (!response.ok) {
      const body = await safeReadJson(response);
      throw new PredictusError(`Authentication failed (${response.status})`, response.status, body);
    }

    const body = (await safeReadJson(response)) as { accessToken?: unknown } | null;
    const token = body?.accessToken;
    if (typeof token !== 'string' || token.length === 0) {
      throw new PredictusError('Auth response missing accessToken', response.status, body);
    }

    this.token = token;
    if (this.onTokenChange) {
      await this.onTokenChange(token);
    }
    return token;
  }

  searchByCpf(cpf: string): Promise<PredictusSearchResult> {
    return this.request(ENDPOINTS.cpf, { cpf });
  }

  searchByCnpj(cnpj: string): Promise<PredictusSearchResult> {
    return this.request(ENDPOINTS.cnpj, { cnpj });
  }

  searchByName(name: string): Promise<PredictusSearchResult> {
    return this.request(ENDPOINTS.name, { nome: name.toUpperCase() });
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    return this.authenticate();
  }

  private async request(path: string, payload: SearchPayload): Promise<PredictusSearchResult> {
    const url = `${this.baseUrl}${path}`;
    let attempt = 0;
    let reauthenticated = false;

    // attempt counts retries on transient failures. Token refresh on 401 is
    // a separate one-shot that does not consume retry budget.
    while (true) {
      const token = await this.ensureToken();
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      } catch (cause) {
        if (attempt >= this.maxRetries) {
          throw new PredictusError(
            `Network error after ${attempt} retries: ${(cause as Error).message}`,
          );
        }
        await this.sleep(this.backoffFor(attempt));
        attempt += 1;
        continue;
      }

      if (response.status === 401) {
        if (reauthenticated) {
          const body = await safeReadJson(response);
          throw new PredictusError('Unauthorized after token refresh', 401, body);
        }
        this.token = null;
        await this.authenticate();
        reauthenticated = true;
        continue;
      }

      if (response.status === 204) return [];

      if (response.ok) {
        const body = await safeReadJson(response);
        if (body == null) return [];
        if (Array.isArray(body)) return body as PredictusSearchResult;
        // Predictus sometimes wraps the array; surface it as-is for callers.
        return [body as never];
      }

      if (response.status >= 500) {
        if (attempt >= this.maxRetries) {
          const body = await safeReadJson(response);
          throw new PredictusError(
            `Server error ${response.status} after ${this.maxRetries} retries`,
            response.status,
            body,
          );
        }
        await this.sleep(this.backoffFor(attempt));
        attempt += 1;
        continue;
      }

      // 4xx (non-401) — non-retryable.
      const body = await safeReadJson(response);
      throw new PredictusError(`Client error ${response.status}`, response.status, body);
    }
  }

  private backoffFor(attempt: number): number {
    return this.initialBackoffMs * 2 ** attempt;
  }
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
