import { EnrichmentRealtime } from '@/components/antifraude/enrichment-realtime';
import { IdentityCard } from '@/components/antifraude/identity-card';
import { IdentityCardCnpj } from '@/components/antifraude/identity-card-cnpj';
import { MediaCard } from '@/components/antifraude/media-card';
import { PepCard } from '@/components/antifraude/pep-card';
import { RelatedCompanies } from '@/components/antifraude/related-companies';
import { SancoesCardCnpj } from '@/components/antifraude/sancoes-card-cnpj';
import { SociosCard, type SocioEntry } from '@/components/antifraude/socios-card';
import type { RelatedCompanyEntry } from '@/components/antifraude/types';
import { BreadcrumbNetwork } from '@/components/breadcrumb-network';
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
import { mask as maskCpf } from '@/lib/validators/cpf';
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

type CpfBirthdate = {
  nome?: string;
  dataNascimento?: string;
  situacaoCadastral?: string;
  nomeMae?: string;
  idade?: number;
  genero?: string;
};

function extractIdentityFromHop1(p: NetrinCompositePayload) {
  const raw = (p as Record<string, unknown>).CpfBirthdate as CpfBirthdate | null | undefined;
  return {
    nome: typeof raw?.nome === 'string' ? raw.nome : undefined,
    dataNascimento: typeof raw?.dataNascimento === 'string' ? raw.dataNascimento : undefined,
    situacaoCadastral:
      typeof raw?.situacaoCadastral === 'string' ? raw.situacaoCadastral : undefined,
    nomeMae: typeof raw?.nomeMae === 'string' ? raw.nomeMae : undefined,
    idade: typeof raw?.idade === 'number' ? raw.idade : undefined,
    genero: typeof raw?.genero === 'string' ? raw.genero : undefined,
  };
}

type PepKyc = {
  currentlyPEP?: unknown;
  currentlySanctioned?: unknown;
  previouslySanctioned?: unknown;
  historyPEP?: unknown[];
  sanctionsHistory?: unknown[];
};

function isSim(v: unknown): boolean {
  return v === true || v === 'Sim' || v === 'SIM' || v === 'S';
}

function extractPepFromHop1(p: NetrinCompositePayload) {
  const slug = (p as Record<string, unknown>).pepKyc as PepKyc | null | undefined;
  const historyPEP = Array.isArray(slug?.historyPEP) ? slug.historyPEP : [];
  const sanctionsHistory = Array.isArray(slug?.sanctionsHistory) ? slug.sanctionsHistory : [];
  // The API ships placeholder rows where every field is empty — filter those out.
  const isNonEmpty = (row: unknown): boolean =>
    !!row &&
    typeof row === 'object' &&
    Object.values(row as Record<string, unknown>).some((v) => v !== '' && v !== 0 && v != null);
  const peps = historyPEP.filter(isNonEmpty);
  const sancoes = sanctionsHistory.filter(isNonEmpty);
  return {
    currentlyPEP: isSim(slug?.currentlyPEP),
    currentlySanctioned: isSim(slug?.currentlySanctioned),
    previouslySanctioned: isSim(slug?.previouslySanctioned),
    historicoCount: peps.length + sancoes.length,
  };
}

type MidiasConsolidado = {
  midiasRiscoReputacional?: {
    riscoReputacional?: {
      value?: {
        qtdTotal?: unknown;
        qtdMidias?: unknown;
        qtdListas?: unknown;
        qtdGov?: unknown;
        qtdAmb?: unknown;
      };
    };
  };
};

function extractMediaFromHop1(p: NetrinCompositePayload) {
  const slug = (p as Record<string, unknown>).midiasConsolidado as
    | MidiasConsolidado
    | null
    | undefined;
  const value = slug?.midiasRiscoReputacional?.riscoReputacional?.value;
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    mencoes: num(value?.qtdTotal),
    qtdMidias: num(value?.qtdMidias),
    qtdListas: num(value?.qtdListas),
    qtdGov: num(value?.qtdGov),
    qtdAmb: num(value?.qtdAmb),
  };
}

type NegocioItem = {
  entidadeRelacionadaDocumento?: unknown;
  entidadeRelacionadadaTipoDeDocumento?: unknown;
  entidadeRelacionadaNome?: unknown;
  tipoDeRelacionamento?: unknown;
  nivelDeRelacionamento?: unknown;
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
  const empresasSlug = (hop1 as Record<string, unknown>).empresasRelacionadasCPF as
    | EmpresasSlug
    | null
    | undefined;
  const negocios: NegocioItem[] = Array.isArray(empresasSlug?.negociosRelacionados)
    ? (empresasSlug.negociosRelacionados as NegocioItem[])
    : [];

  return negocios.reduce<RelatedCompanyEntry[]>((acc, item) => {
    const isCnpj = item.entidadeRelacionadadaTipoDeDocumento === 'CNPJ';
    if (!isCnpj) return acc;

    const cnpjRaw =
      typeof item.entidadeRelacionadaDocumento === 'string'
        ? item.entidadeRelacionadaDocumento.replace(/\D/g, '')
        : '';
    if (cnpjRaw.length !== 14) return acc;

    const vinculo =
      typeof item.tipoDeRelacionamento === 'string' ? item.tipoDeRelacionamento : undefined;

    const dataInicio =
      typeof item.dataInicioRelacionamento === 'string' ? item.dataInicioRelacionamento : undefined;
    const dataFim =
      typeof item.dataFimRelacionamento === 'string' ? item.dataFimRelacionamento : undefined;
    const ativo =
      !dataFim ||
      dataFim === '9999-12-31' ||
      dataFim === '0001-01-01T00:00:00Z' ||
      dataFim.startsWith('0001-');

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
      razaoSocial:
        typeof item.entidadeRelacionadaNome === 'string' ? item.entidadeRelacionadaNome : undefined,
      vinculo,
      ativo,
      dataInicio,
      dataFim,
      hop2,
    });
    return acc;
  }, []);
}

// ── CNPJ-root extraction helpers ─────────────────────────────────────────────

type EspCnpjCompleto = {
  razaoSocial?: unknown;
  nomeFantasia?: unknown;
  situacaoCadastral?: unknown;
  capitalSocial?: unknown;
  atividadeEconomica?: unknown;
  dataAbertura?: unknown;
};

function extractCnpjIdentity(p: NetrinCompositePayload) {
  const slug = (p as Record<string, unknown>)['esp-cnpj-completo'] as
    | EspCnpjCompleto
    | null
    | undefined;
  return {
    razaoSocial: typeof slug?.razaoSocial === 'string' ? slug.razaoSocial : undefined,
    nomeFantasia: typeof slug?.nomeFantasia === 'string' ? slug.nomeFantasia : undefined,
    situacaoCadastral:
      typeof slug?.situacaoCadastral === 'string' ? slug.situacaoCadastral : undefined,
    capitalSocial: typeof slug?.capitalSocial === 'number' ? slug.capitalSocial : undefined,
    atividadePrincipal:
      typeof slug?.atividadeEconomica === 'string' ? slug.atividadeEconomica : undefined,
    dataAbertura: typeof slug?.dataAbertura === 'string' ? slug.dataAbertura : undefined,
  };
}

type PepKycCnpj = { sancionado?: unknown };
type CeisItem = { ativo?: unknown; descricaoSancao?: unknown };
type CnepItem = { ativo?: unknown; descricaoSancao?: unknown };
type TrabalhoEscravoSlug = { empregador?: unknown[] };

function extractCnpjSancoes(p: NetrinCompositePayload) {
  const pep = (p as Record<string, unknown>)['pep-kyc-cnpj'] as PepKycCnpj | null | undefined;
  const ceisList = (p as Record<string, unknown>)['portal-transparencia-ceis'] as
    | { sancoes?: CeisItem[] }
    | null
    | undefined;
  const cnepList = (p as Record<string, unknown>)['portal-transparencia-cnep'] as
    | { sancoes?: CnepItem[] }
    | null
    | undefined;
  const trabSlug = (p as Record<string, unknown>)['trabalho-escravo'] as
    | TrabalhoEscravoSlug
    | null
    | undefined;
  return {
    sancionado: pep?.sancionado === true || pep?.sancionado === 'S',
    ceis: (ceisList?.sancoes ?? []).map((c) => ({
      ativo: c.ativo === true,
      descricao: typeof c.descricaoSancao === 'string' ? c.descricaoSancao : undefined,
    })),
    cnep: (cnepList?.sancoes ?? []).map((c) => ({
      ativo: c.ativo === true,
      descricao: typeof c.descricaoSancao === 'string' ? c.descricaoSancao : undefined,
    })),
    trabalhoEscravo: Array.isArray(trabSlug?.empregador) && trabSlug.empregador.length > 0,
  };
}

type PessoasRelCnpjEntity = {
  cpf?: unknown;
  nome?: unknown;
  vinculoDoRelacionamento?: unknown;
  percentualParticipacaoSociedade?: unknown;
};

function extractSocios(
  p: NetrinCompositePayload,
  cachedCpfHashes: Set<string>,
): SocioEntry[] {
  const slug = (p as Record<string, unknown>)['pessoas-relacionadas-cnpj'] as
    | { entidadesRelacionadas?: PessoasRelCnpjEntity[] }
    | null
    | undefined;
  const list = Array.isArray(slug?.entidadesRelacionadas) ? slug.entidadesRelacionadas : [];
  return list.reduce<SocioEntry[]>((acc, item) => {
    const cpfRaw = typeof item.cpf === 'string' ? item.cpf.replace(/\D/g, '') : '';
    if (cpfRaw.length !== 11) return acc;
    let cpfHash: string;
    try {
      cpfHash = hashDocument('cpf', cpfRaw);
    } catch {
      return acc;
    }
    acc.push({
      cpfHash,
      maskedPreview: maskCpf(cpfRaw),
      nome: typeof item.nome === 'string' ? item.nome : undefined,
      vinculo:
        typeof item.vinculoDoRelacionamento === 'string'
          ? item.vinculoDoRelacionamento
          : undefined,
      percentual:
        typeof item.percentualParticipacaoSociedade === 'number'
          ? item.percentualParticipacaoSociedade
          : undefined,
      hasCached: cachedCpfHashes.has(cpfHash),
    });
    return acc;
  }, []);
}

export default async function ResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ hash: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const user = await requireAuth();
  const { hash } = await params;
  const { path: currentPath } = await searchParams;
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
  const byCpf = enrichment?.payloads.byCpf ?? {};
  const job = enrichment?.job ?? null;

  const identityProps = hop1 ? extractIdentityFromHop1(hop1) : null;
  const pepProps = hop1 ? extractPepFromHop1(hop1) : null;
  const mediaProps = hop1 ? extractMediaFromHop1(hop1) : null;
  const relatedItems = hop1 ? buildRelatedCompanies(hop1, byCnpj) : [];

  // CNPJ-root branch: payload is byCnpj[documentHash] instead of hop1
  const cachedCpfHashes = new Set(Object.keys(byCpf));
  const cnpjRootPayload = searchRow.search_type === 'cnpj' ? (byCnpj[documentHash] ?? null) : null;

  const cnpjIdentityProps = cnpjRootPayload ? extractCnpjIdentity(cnpjRootPayload) : null;
  const cnpjSancoesProps = cnpjRootPayload ? extractCnpjSancoes(cnpjRootPayload) : null;
  const cnpjMediaProps = cnpjRootPayload ? extractMediaFromHop1(cnpjRootPayload) : null;
  const socios = cnpjRootPayload ? extractSocios(cnpjRootPayload, cachedCpfHashes) : [];

  // Status for cards: if job exists but is still running, show skeleton state
  const jobRunning = job?.status === 'pending' || job?.status === 'running';
  // For CNPJ root, use cnpjRootPayload as the data presence indicator instead of hop1
  const hasData = searchRow.search_type === 'cnpj' ? !!cnpjRootPayload : !!hop1;
  const cardStatus = !job
    ? ('missing' as const)
    : jobRunning
      ? ('running' as const)
      : hasData
        ? ('success' as const)
        : job.status === 'failed'
          ? ('error' as const)
          : ('success' as const);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Consulta arquivada
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          {searchRow.term_preview}
        </h1>
      </header>

      <BreadcrumbNetwork pathParam={currentPath} currentHash={documentHash} />

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
            </div>
          </div>

          <EnrichmentRealtime jobId={job.id} />

          {searchRow.search_type === 'cpf' ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <IdentityCard
                  status={cardStatus}
                  nome={identityProps?.nome}
                  dataNascimento={identityProps?.dataNascimento}
                  situacaoCadastral={identityProps?.situacaoCadastral}
                  nomeMae={identityProps?.nomeMae}
                  idade={identityProps?.idade}
                  genero={identityProps?.genero}
                />
                <PepCard
                  status={cardStatus}
                  currentlyPEP={pepProps?.currentlyPEP}
                  currentlySanctioned={pepProps?.currentlySanctioned}
                  previouslySanctioned={pepProps?.previouslySanctioned}
                  historicoCount={pepProps?.historicoCount}
                />
                <MediaCard
                  status={cardStatus}
                  mencoes={mediaProps?.mencoes}
                  qtdMidias={mediaProps?.qtdMidias}
                  qtdListas={mediaProps?.qtdListas}
                  qtdGov={mediaProps?.qtdGov}
                  qtdAmb={mediaProps?.qtdAmb}
                />
              </div>
              <RelatedCompanies
                status={cardStatus}
                items={relatedItems}
                currentPath={currentPath ?? documentHash}
              />
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <IdentityCardCnpj
                  status={cardStatus}
                  razaoSocial={cnpjIdentityProps?.razaoSocial}
                  nomeFantasia={cnpjIdentityProps?.nomeFantasia}
                  situacaoCadastral={cnpjIdentityProps?.situacaoCadastral}
                  capitalSocial={cnpjIdentityProps?.capitalSocial}
                  atividadePrincipal={cnpjIdentityProps?.atividadePrincipal}
                  dataAbertura={cnpjIdentityProps?.dataAbertura}
                />
                <SancoesCardCnpj
                  status={cardStatus}
                  sancionado={cnpjSancoesProps?.sancionado}
                  ceis={cnpjSancoesProps?.ceis}
                  cnep={cnpjSancoesProps?.cnep}
                  trabalhoEscravo={cnpjSancoesProps?.trabalhoEscravo}
                />
                <MediaCard
                  status={cardStatus}
                  mencoes={cnpjMediaProps?.mencoes}
                  qtdMidias={cnpjMediaProps?.qtdMidias}
                  qtdListas={cnpjMediaProps?.qtdListas}
                  qtdGov={cnpjMediaProps?.qtdGov}
                  qtdAmb={cnpjMediaProps?.qtdAmb}
                />
              </div>
              <SociosCard
                status={cardStatus}
                parentCnpjHash={documentHash}
                currentPath={currentPath ?? documentHash}
                socios={socios}
              />
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}
