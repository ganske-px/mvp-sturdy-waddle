import { IdentityCard } from '@/components/antifraude/identity-card';
import { MediaCard } from '@/components/antifraude/media-card';
import { PepCard } from '@/components/antifraude/pep-card';
import { RelatedCompanies } from '@/components/antifraude/related-companies';
import { RestrictionsCard } from '@/components/antifraude/restrictions-card';
import type { RelatedCompanyEntry } from '@/components/antifraude/types';
import { NetworkCta } from '@/components/network-cta';
import { ProcessResultsTable } from '@/components/process-results-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listUserPermissions, requireAuth } from '@/lib/auth/permissions';
import { hashDocument } from '@/lib/hash';
import { loadEnrichmentForRoot } from '@/lib/netrin/result-loader';
import type { NetrinCompositePayload } from '@/lib/netrin/types';
import { getCachedResults } from '@/lib/predictus/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { AlertCircleIcon, ClockIcon, SearchIcon } from 'lucide-react';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Resultado da consulta — Radar PX',
};

const TYPE_LABELS: Record<'cpf' | 'cnpj' | 'name', string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  name: 'Nome',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type SearchRow = {
  search_type: 'cpf' | 'cnpj' | 'name';
  term_preview: string;
  created_at: string;
  result_count: number;
  error_message: string | null;
};

// ── Payload extraction helpers ────────────────────────────────────────────────
// Each helper reads a specific slug from a composite payload and returns a
// typed subset. We use `unknown` casts with explicit narrowing to avoid `any`.

type EspCpf = {
  nome?: string;
  dataNascimento?: string;
  situacaoCadastral?: string;
};

function extractIdentityFromHop1(p: NetrinCompositePayload) {
  const raw = p['esp-cpf'] as EspCpf | null | undefined;
  return {
    nome: typeof raw?.nome === 'string' ? raw.nome : undefined,
    dataNascimento: typeof raw?.dataNascimento === 'string' ? raw.dataNascimento : undefined,
    situacaoCadastral:
      typeof raw?.situacaoCadastral === 'string' ? raw.situacaoCadastral : undefined,
  };
}

type PepKycEntry = {
  situacaoAtual?: boolean | string;
  sancionadoAtual?: boolean | string;
};

type PepKycSlug = {
  peps?: unknown[];
  sancoes?: unknown[];
};

function extractPepFromHop1(p: NetrinCompositePayload) {
  const slug = p['pep-kyc-cpf'] as PepKycSlug | null | undefined;
  const peps: PepKycEntry[] = Array.isArray(slug?.peps) ? (slug.peps as PepKycEntry[]) : [];
  const sancoes: PepKycEntry[] = Array.isArray(slug?.sancoes)
    ? (slug.sancoes as PepKycEntry[])
    : [];
  const currentlyPEP = peps.some((e) => e.situacaoAtual === true || e.situacaoAtual === 'ATIVO');
  const currentlySanctioned = sancoes.some(
    (e) => e.sancionadoAtual === true || e.sancionadoAtual === 'ATIVO',
  );
  return {
    currentlyPEP,
    currentlySanctioned,
    historicoCount: peps.length + sancoes.length,
  };
}

type MidiaItem = {
  titulo?: unknown;
  url?: unknown;
  dataPublicacao?: unknown;
};

type MidiaSlug = {
  mencoes?: unknown;
  itens?: unknown[];
};

function extractMediaFromHop1(p: NetrinCompositePayload) {
  const slug = p['midias-consolidado'] as MidiaSlug | null | undefined;
  const mencoes = typeof slug?.mencoes === 'number' ? slug.mencoes : 0;
  const rawItens: MidiaItem[] = Array.isArray(slug?.itens) ? (slug.itens as MidiaItem[]) : [];
  const itens = rawItens.map((it) => ({
    titulo: typeof it.titulo === 'string' ? it.titulo : '(sem título)',
    url: typeof it.url === 'string' ? it.url : undefined,
    data: typeof it.dataPublicacao === 'string' ? it.dataPublicacao : undefined,
  }));
  return { mencoes, itens };
}

function extractRestrictionsFromHop1(p: NetrinCompositePayload) {
  const slug = p['pessoas-impedidas-apostar'] as { impedido?: unknown } | null | undefined;
  const apostasImpedido = slug?.impedido === true || slug?.impedido === 'S';
  return { apostasImpedido };
}

type NegocioItem = {
  cnpj?: unknown;
  razaoSocial?: unknown;
  tipoVinculo?: unknown;
  vinculoDoRelacionamento?: unknown;
  dataInicioRelacionamento?: unknown;
  dataFimRelacionamento?: unknown;
};

type EmpresasSlug = {
  negociosRelacionados?: unknown[];
};

type EspCnpjSlug = {
  razaoSocial?: unknown;
  situacaoCadastral?: unknown;
  capitalSocial?: unknown;
};

type PepKycCnpjSlug = {
  sancionado?: unknown;
};

type PessoasRelCnpjSlug = {
  entidadesRelacionadas?: unknown[];
};

type EntidadeItem = {
  cpf?: unknown;
};

function buildRelatedCompanies(
  hop1: NetrinCompositePayload,
  byCnpj: Record<string, NetrinCompositePayload>,
): RelatedCompanyEntry[] {
  const empresasSlug = hop1['empresas-relacionadas-cpf'] as EmpresasSlug | null | undefined;
  const negocios: NegocioItem[] = Array.isArray(empresasSlug?.negociosRelacionados)
    ? (empresasSlug.negociosRelacionados as NegocioItem[])
    : [];

  return negocios.reduce<RelatedCompanyEntry[]>((acc, item) => {
    const cnpjRaw = typeof item.cnpj === 'string' ? item.cnpj.replace(/\D/g, '') : '';
    if (cnpjRaw.length !== 14) return acc;

    const vinculo =
      typeof item.tipoVinculo === 'string'
        ? item.tipoVinculo
        : typeof item.vinculoDoRelacionamento === 'string'
          ? item.vinculoDoRelacionamento
          : undefined;

    const dataInicio =
      typeof item.dataInicioRelacionamento === 'string' ? item.dataInicioRelacionamento : undefined;
    const dataFim =
      typeof item.dataFimRelacionamento === 'string' ? item.dataFimRelacionamento : undefined;
    const ativo = !dataFim || dataFim === '9999-12-31';

    // Look up hop2 enrichment for this CNPJ if available
    let hop2: RelatedCompanyEntry['hop2'] | undefined;
    const cnpjHash = hashDocument('cnpj', cnpjRaw);
    const hop2Payload = byCnpj[cnpjHash];
    if (hop2Payload) {
      const espCnpj = hop2Payload['esp-cnpj-completo'] as EspCnpjSlug | null | undefined;
      const pepCnpj = hop2Payload['pep-kyc-cnpj'] as PepKycCnpjSlug | null | undefined;
      const pessoasCnpj = hop2Payload['pessoas-relacionadas-cnpj'] as
        | PessoasRelCnpjSlug
        | null
        | undefined;
      const sociosList: EntidadeItem[] = Array.isArray(pessoasCnpj?.entidadesRelacionadas)
        ? (pessoasCnpj.entidadesRelacionadas as EntidadeItem[])
        : [];
      const sociosCpfHashes = sociosList
        .map((e) => (typeof e.cpf === 'string' ? e.cpf.replace(/\D/g, '') : ''))
        .filter((c) => c.length === 11)
        .map((cpfRaw) => {
          try {
            return hashDocument('cpf', cpfRaw);
          } catch {
            return '';
          }
        })
        .filter(Boolean);

      hop2 = {
        situacaoCadastral:
          typeof espCnpj?.situacaoCadastral === 'string' ? espCnpj.situacaoCadastral : undefined,
        capitalSocial:
          typeof espCnpj?.capitalSocial === 'number' ? espCnpj.capitalSocial : undefined,
        sancionado: pepCnpj?.sancionado === true || pepCnpj?.sancionado === 'S',
        sociosCpfHashes,
      };
    }

    acc.push({
      cnpj: cnpjRaw,
      razaoSocial: typeof item.razaoSocial === 'string' ? item.razaoSocial : undefined,
      vinculo,
      ativo,
      dataInicio,
      dataFim,
      hop2,
    });
    return acc;
  }, []);
}

export default async function ResultPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const user = await requireAuth();
  const { hash } = await params;
  const documentHash = decodeURIComponent(hash);

  const supabase = await createClient();
  const { data: searchRow } = await supabase
    .from('searches')
    .select('search_type, term_preview, created_at, result_count, error_message')
    .eq('document_hash', documentHash)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .returns<SearchRow>();

  if (!searchRow) {
    redirect('/history');
  }

  const admin = createAdminClient();
  let cached: Awaited<ReturnType<typeof getCachedResults>> = null;
  try {
    cached = await getCachedResults(admin, documentHash);
  } catch (e) {
    console.warn('result page: cache lookup failed', e);
  }

  // Load enrichment data — only available for CPF/CNPJ searches
  let enrichment: Awaited<ReturnType<typeof loadEnrichmentForRoot>> = null;
  if (searchRow.search_type === 'cpf' || searchRow.search_type === 'cnpj') {
    try {
      enrichment = await loadEnrichmentForRoot(admin, {
        userId: user.id,
        rootHash: documentHash,
        rootType: searchRow.search_type,
      });
    } catch (e) {
      console.warn('result page: enrichment load failed', e);
    }
  }

  const perms = await listUserPermissions(user.id);
  const canSeeNetwork = user.role === 'admin' || perms.has('search_network');
  const networkHash = searchRow.search_type === 'name' ? null : documentHash;

  // Derive antifraude card props from hop1 payload
  const hop1 = enrichment?.payloads.hop1 ?? null;
  const byCnpj = enrichment?.payloads.byCnpj ?? {};
  const job = enrichment?.job ?? null;

  const identityProps = hop1 ? extractIdentityFromHop1(hop1) : null;
  const pepProps = hop1 ? extractPepFromHop1(hop1) : null;
  const mediaProps = hop1 ? extractMediaFromHop1(hop1) : null;
  const restrictionsProps = hop1 ? extractRestrictionsFromHop1(hop1) : null;
  const relatedItems = hop1 ? buildRelatedCompanies(hop1, byCnpj) : [];

  // Status for cards: if job exists but is still running, show skeleton state
  const jobRunning = job?.status === 'pending' || job?.status === 'running';
  const cardStatus = !job
    ? ('missing' as const)
    : jobRunning
      ? ('running' as const)
      : hop1
        ? ('success' as const)
        : job.status === 'failed'
          ? ('error' as const)
          : ('success' as const);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Consulta arquivada
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          {searchRow.term_preview}
        </h1>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>
                {TYPE_LABELS[searchRow.search_type]} · {searchRow.result_count} resultado
                {searchRow.result_count === 1 ? '' : 's'}
              </CardTitle>
              <CardDescription>
                Pesquisada em {formatDateTime(searchRow.created_at)}.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {cached ? (
                <Badge variant="info">
                  <ClockIcon />
                  Em cache
                </Badge>
              ) : null}
              <NetworkCta networkHash={networkHash} canSeeNetwork={canSeeNetwork} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {searchRow.error_message ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{searchRow.error_message}</span>
            </div>
          ) : !cached ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
              <SearchIcon className="size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">Resultados não estão mais em cache</p>
              <p className="text-xs text-muted-foreground">
                O cache tem TTL de 30 dias. Refaça a busca para ver os processos atualizados.
              </p>
            </div>
          ) : cached.results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/30 py-10">
              <SearchIcon className="size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">Nenhum processo encontrado</p>
              <p className="text-xs text-muted-foreground">
                O documento aparentava estar limpo na fonte de dados.
              </p>
            </div>
          ) : (
            <ProcessResultsTable results={cached.results} />
          )}
        </CardContent>
      </Card>

      {/* Antifraude section — only rendered when an enrichment job exists */}
      {job ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-xl font-semibold tracking-tight text-foreground">
              Análise antifraude
            </h2>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge
                variant={
                  job.status === 'completed'
                    ? 'success'
                    : job.status === 'failed'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {job.status === 'completed'
                  ? 'Concluído'
                  : job.status === 'partial'
                    ? 'Parcial'
                    : job.status === 'failed'
                      ? 'Erro'
                      : job.status === 'running'
                        ? 'Em andamento'
                        : 'Pendente'}
              </Badge>
              {job.hop2Total > 0 ? (
                <Badge variant="outline">
                  {job.hop2Done}/{job.hop2Total} empresas
                </Badge>
              ) : null}
            </div>
          </div>

          {/* TODO: EnrichmentRealtime hook from Task H3 */}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <IdentityCard
              status={cardStatus}
              nome={identityProps?.nome}
              dataNascimento={identityProps?.dataNascimento}
              situacaoCadastral={identityProps?.situacaoCadastral}
            />
            <PepCard
              status={cardStatus}
              currentlyPEP={pepProps?.currentlyPEP}
              currentlySanctioned={pepProps?.currentlySanctioned}
              historicoCount={pepProps?.historicoCount}
            />
            <MediaCard
              status={cardStatus}
              mencoes={mediaProps?.mencoes}
              itens={mediaProps?.itens}
            />
          </div>

          <RestrictionsCard
            status={cardStatus}
            apostasImpedido={restrictionsProps?.apostasImpedido}
          />

          <RelatedCompanies status={cardStatus} items={relatedItems} />
        </section>
      ) : null}
    </main>
  );
}
