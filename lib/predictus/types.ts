export type PredictusSearchType = 'cpf' | 'cnpj' | 'name';

// Subset of the Predictus process payload we surface. The full shape has many
// optional fields; consumers should treat unknown keys as unknown.
export type PredictusProcess = {
  numeroProcessoUnico?: string;
  tribunal?: string;
  classeProcessual?: string;
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
