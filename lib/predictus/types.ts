export type PredictusSearchType = 'cpf' | 'cnpj' | 'name';

// Subset of the Predictus process payload we surface. The full shape has many
// optional fields; consumers should treat unknown keys as unknown.
export type PredictusProcess = {
  numeroProcessoUnico?: string;
  tribunal?: string | { nome?: string; sigla?: string; codigo?: string };
  classeProcessual?: string | { nome?: string; codigoCNJ?: string };
  valorCausa?: { valor?: number | string };
  partes?: unknown[];
  movimentos?: unknown[];
  [key: string]: unknown;
};

export type PredictusSearchResult = PredictusProcess[];

export type PredictusClientConfig = {
  baseUrl: string;
  username: string;
  password: string;
  /** Replaces global fetch — used by tests. */
  fetch?: typeof fetch;
  /** Replaces a real timer-based sleep — used by tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Maximum number of retries on 5xx and network errors. Defaults to 3. */
  maxRetries?: number;
  /** Initial backoff in ms. Doubles every retry. Defaults to 1000ms. */
  initialBackoffMs?: number;
  /**
   * Token to use on the first request without contacting /auth. Use this when
   * a stored token has been pulled from `predictus_token` to skip auth on
   * cold starts. If the token turns out to be stale the client will refresh
   * on a 401 and notify through `onTokenChange`.
   */
  initialToken?: string;
  /**
   * Called whenever the client obtains a new access token (initial auth or
   * a refresh after 401). The client awaits the promise before continuing,
   * giving the store a chance to persist before the next request fires.
   */
  onTokenChange?: (token: string) => Promise<void> | void;
};

export class PredictusError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'PredictusError';
  }
}
