import { isValid as isCnpjValid, normalize as normalizeCnpj } from '@/lib/validators/cnpj.ts';
import { isValid as isCpfValid, normalize as normalizeCpf } from '@/lib/validators/cpf.ts';

const DEFAULT_MAX_DOCUMENTS = 250;

// Match CNPJs greedy-first so they don't get partially captured as CPFs.
// XX.XXX.XXX/XXXX-XX or 14 raw digits.
const CNPJ_REGEX = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

// CPF: XXX.XXX.XXX-XX or 11 raw digits.
const CPF_REGEX = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

export type CsvParseOk = {
  ok: true;
  cpfs: string[];
  cnpjs: string[];
  totalDocuments: number;
};

export type CsvParseErrorKind = 'empty' | 'no_documents_found' | 'limit_exceeded';

export type CsvParseErr = {
  ok: false;
  error: CsvParseErrorKind;
  message: string;
};

export type CsvParseResult = CsvParseOk | CsvParseErr;

export type CsvParseOptions = {
  maxDocuments?: number;
};

export function parseCsv(input: string, opts: CsvParseOptions = {}): CsvParseResult {
  const maxDocuments = opts.maxDocuments ?? DEFAULT_MAX_DOCUMENTS;

  if (!input || !input.trim()) {
    return { ok: false, error: 'empty', message: 'CSV input is empty.' };
  }

  // Extract CNPJs first, then strip their matches from the text before
  // searching for CPFs — prevents CNPJ digit substrings from being
  // misread as CPFs.
  const cnpjMatches = input.match(CNPJ_REGEX) ?? [];
  const cnpjs = new Set<string>();
  for (const match of cnpjMatches) {
    const digits = match.replace(/\D/g, '');
    if (digits.length === 14 && isCnpjValid(digits)) {
      cnpjs.add(normalizeCnpj(digits));
    }
  }

  const inputWithoutCnpjs = input.replace(CNPJ_REGEX, ' ');
  const cpfMatches = inputWithoutCnpjs.match(CPF_REGEX) ?? [];
  const cpfs = new Set<string>();
  for (const match of cpfMatches) {
    const digits = match.replace(/\D/g, '');
    if (digits.length === 11 && isCpfValid(digits)) {
      cpfs.add(normalizeCpf(digits));
    }
  }

  const totalDocuments = cpfs.size + cnpjs.size;

  if (totalDocuments === 0) {
    return {
      ok: false,
      error: 'no_documents_found',
      message: 'No valid CPF or CNPJ found in the CSV.',
    };
  }

  if (totalDocuments > maxDocuments) {
    return {
      ok: false,
      error: 'limit_exceeded',
      message: `CSV contains ${totalDocuments} documents, which exceeds the limit of ${maxDocuments}.`,
    };
  }

  return {
    ok: true,
    cpfs: [...cpfs].sort(),
    cnpjs: [...cnpjs].sort(),
    totalDocuments,
  };
}
