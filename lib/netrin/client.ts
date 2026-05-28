// lib/netrin/client.ts
import {
  type NetrinClientConfig,
  type NetrinCompositePayload,
  type NetrinDocumentType,
  NetrinError,
  type NetrinSlug,
} from './types.ts';

const COMPOSITE_PATH = '/v1/consulta-composta';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_PEP_ACURACIA = 95;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class NetrinClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly pepAcuracia: number;

  constructor(config: NetrinClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = config.sleep ?? defaultSleep;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialBackoffMs = config.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.pepAcuracia = config.pepAcuracia ?? DEFAULT_PEP_ACURACIA;
  }

  async fetchComposta(
    docType: NetrinDocumentType,
    documentRaw: string,
    slugs: readonly NetrinSlug[],
  ): Promise<NetrinCompositePayload> {
    if (slugs.length === 0) {
      throw new NetrinError('fetchComposta requires at least 1 slug', { slugs });
    }

    const url = this.buildUrl(docType, documentRaw, slugs);
    let attempt = 0;
    while (true) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, { method: 'GET' });
      } catch (cause) {
        if (attempt >= this.maxRetries) {
          throw new NetrinError(
            `network error after ${attempt} retries: ${(cause as Error).message}`,
            { slugs },
          );
        }
        await this.sleep(this.backoffFor(attempt));
        attempt += 1;
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new NetrinError(`netrin auth failed (${response.status})`, {
          status: response.status,
          slugs,
        });
      }

      if (response.ok) {
        const body = await safeReadJson(response);
        return (body ?? {}) as NetrinCompositePayload;
      }

      if (response.status >= 500) {
        if (attempt >= this.maxRetries) {
          throw new NetrinError(
            `netrin upstream ${response.status} after ${this.maxRetries} retries`,
            { status: response.status, slugs },
          );
        }
        await this.sleep(this.backoffFor(attempt));
        attempt += 1;
        continue;
      }

      throw new NetrinError(`netrin client error ${response.status}`, {
        status: response.status,
        slugs,
      });
    }
  }

  private buildUrl(
    docType: NetrinDocumentType,
    documentRaw: string,
    slugs: readonly NetrinSlug[],
  ): string {
    const params = new URLSearchParams();
    params.set('token', this.token);
    params.set(docType, documentRaw);
    for (const slug of slugs) params.append('s', slug);
    if (slugs.some((s) => s.startsWith('pep-kyc-'))) {
      params.set('acuracia', String(this.pepAcuracia));
    }
    if (slugs.includes('midias-consolidado')) {
      params.set('documento', docType.toUpperCase());
    }
    return `${this.baseUrl}${COMPOSITE_PATH}?${params.toString()}`;
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
