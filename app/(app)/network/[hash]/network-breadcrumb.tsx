import { createClient } from '@/lib/supabase/server';
import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';

type SearchRow = {
  document_hash: string;
  term_preview: string;
  search_type: 'cpf' | 'cnpj' | 'name';
};

export type NetworkBreadcrumbProps = {
  /** Cadeia de telas de detalhe (hashes separados por vírgula) que levou até a rede. */
  originPath: string | null;
  /** Hash central da rede; usado como fallback quando não há cadeia. */
  centerHash: string;
};

export async function NetworkBreadcrumb({ originPath, centerHash }: NetworkBreadcrumbProps) {
  let hashes = (originPath ?? '').split(',').filter(Boolean);
  if (hashes.length === 0) hashes = [centerHash];

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('searches')
    .select('document_hash, term_preview, search_type')
    .in('document_hash', hashes)
    .returns<SearchRow[]>();

  const byHash = new Map((rows ?? []).map((r) => [r.document_hash, r] as const));

  return (
    <nav
      aria-label="Voltar aos detalhes"
      className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
    >
      {hashes.map((h, idx) => {
        const term = byHash.get(h)?.term_preview ?? '…';
        const subpath = hashes.slice(0, idx + 1).join(',');
        return (
          <span key={subpath} className="flex items-center gap-1">
            <Link
              href={`/search/result/${encodeURIComponent(h)}?path=${encodeURIComponent(subpath)}`}
              className="hover:text-foreground hover:underline"
            >
              {term}
            </Link>
            <ChevronRightIcon className="size-3" aria-hidden />
          </span>
        );
      })}
      <span className="font-semibold text-foreground">Rede completa</span>
    </nav>
  );
}
