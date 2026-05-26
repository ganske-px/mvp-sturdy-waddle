import { createClient } from '@/lib/supabase/server';
import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';

export type BreadcrumbNetworkProps = {
  pathParam: string | undefined;
  currentHash: string;
};

type SearchRow = {
  document_hash: string;
  term_preview: string;
  search_type: 'cpf' | 'cnpj' | 'name';
};

export async function BreadcrumbNetwork({ pathParam, currentHash }: BreadcrumbNetworkProps) {
  if (!pathParam) return null;

  const hashes = pathParam.split(',').filter(Boolean);
  if (hashes.length < 2) return null;

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('searches')
    .select('document_hash, term_preview, search_type')
    .in('document_hash', hashes)
    .returns<SearchRow[]>();

  const byHash = new Map((rows ?? []).map((r) => [r.document_hash, r] as const));

  const items = hashes.map(
    (h): SearchRow =>
      byHash.get(h) ?? {
        document_hash: h,
        term_preview: '…',
        search_type: 'cpf',
      },
  );

  // Collapse if too long: first + ellipsis + last 3
  const firstItem = items[0];
  const displayed: (SearchRow & { collapsed?: boolean })[] =
    items.length <= 5 || !firstItem
      ? items
      : [
          firstItem,
          { document_hash: '__ellipsis__', term_preview: '…', search_type: 'cpf', collapsed: true },
          ...items.slice(-3),
        ];

  return (
    <nav
      aria-label="Caminho na rede"
      className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
    >
      {displayed.map((item, idx) => {
        const isCurrent = item.document_hash === currentHash;
        const isLast = idx === displayed.length - 1;
        const isEllipsis = item.collapsed === true;

        // For non-current, non-ellipsis links: build the sub-path ending at this item
        const targetIndex = isEllipsis ? -1 : hashes.indexOf(item.document_hash);
        const subpath = targetIndex >= 0 ? hashes.slice(0, targetIndex + 1).join(',') : '';

        return (
          <span key={`${item.document_hash}-${idx}`} className="flex items-center gap-1">
            {isCurrent ? (
              <span className="font-semibold text-foreground">{item.term_preview}</span>
            ) : isEllipsis ? (
              <span aria-hidden>…</span>
            ) : (
              <Link
                href={`/search/result/${encodeURIComponent(item.document_hash)}?path=${encodeURIComponent(subpath)}`}
                className="hover:text-foreground hover:underline"
              >
                {item.term_preview}
              </Link>
            )}
            {!isLast ? <ChevronRightIcon className="size-3" aria-hidden /> : null}
          </span>
        );
      })}
    </nav>
  );
}
