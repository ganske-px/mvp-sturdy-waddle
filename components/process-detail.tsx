import { Badge } from '@/components/ui/badge';
import type { PredictusProcess } from '@/lib/predictus/types';
import { mask as maskCnpj } from '@/lib/validators/cnpj';
import { mask as maskCpf } from '@/lib/validators/cpf';
import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type Party = {
  tipo?: string;
  polo?: string;
  nome?: string;
  cpf?: string;
  cnpj?: string;
  advogados?: Array<{
    nome?: string;
    oab?: { uf?: string; numero?: string | number };
  }>;
};

type MaybeMovement = {
  dataMovimento?: string;
  data?: string;
  descricao?: string;
  texto?: string;
  nome?: string;
};

type AssuntoCNJ = { titulo?: string; codigoCNJ?: string; ePrincipal?: boolean };

type Julgamento = {
  dataJulgamento?: string;
  tipoJulgamento?: string;
  statusJulgamento?: string;
};

type StatusPredictus = {
  statusProcesso?: string;
  julgamentos?: Julgamento[];
  dataArquivamento?: string;
  dataTransitoJulgado?: string;
  ramoDireito?: string;
  valorExecucao?: { valor?: number | string };
};

type ProcessoRelacionado = { numeroProcesso?: string };

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function formatBRL(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: unknown): string | undefined {
  if (typeof iso !== 'string' || iso.length < 10) return undefined;
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return undefined;
  return `${d}/${m}/${y}`;
}

function partyDoc(p: Party): string | null {
  if (p.cpf) {
    const digits = p.cpf.replace(/\D/g, '');
    if (digits.length === 11) return maskCpf(digits);
  }
  if (p.cnpj) {
    const digits = p.cnpj.replace(/\D/g, '');
    if (digits.length === 14) return maskCnpj(digits);
  }
  return null;
}

function movementSummary(m: MaybeMovement): { date: string | null; text: string } {
  const date = m.dataMovimento ?? m.data ?? null;
  const text = m.descricao ?? m.texto ?? m.nome ?? '—';
  return { date, text: String(text) };
}

function tribunalLong(t: PredictusProcess['tribunal']): string | undefined {
  if (!t) return undefined;
  if (typeof t === 'object') return t.nome ?? t.sigla ?? undefined;
  return t;
}

function classeLong(c: PredictusProcess['classeProcessual']): string | undefined {
  if (!c) return undefined;
  if (typeof c === 'object') {
    if (!c.nome) return undefined;
    return c.codigoCNJ ? `${c.nome} (CNJ ${c.codigoCNJ})` : c.nome;
  }
  return c;
}

function Info({ label, value }: { label: string; value?: ReactNode }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div>
      <dt className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-light text-foreground/90">{value}</dd>
    </div>
  );
}

export function ProcessDetail({ process: p }: { process: PredictusProcess }) {
  const partes = (p.partes ?? []) as Party[];
  const movimentos = (p.movimentos ?? []) as MaybeMovement[];
  const assuntos = (Array.isArray(p.assuntosCNJ) ? p.assuntosCNJ : []) as AssuntoCNJ[];
  const sp = (p.statusPredictus ?? {}) as StatusPredictus;
  const julgamentos = Array.isArray(sp.julgamentos) ? sp.julgamentos : [];
  const relacionados = (
    Array.isArray(p.processosRelacionados) ? p.processosRelacionados : []
  ) as ProcessoRelacionado[];

  const tribunal = tribunalLong(p.tribunal);
  const uf = str(p.uf);
  const grau = typeof p.grauProcesso === 'number' ? p.grauProcesso : undefined;
  const status = sp.statusProcesso ?? str(p.statusObservacao);
  const tramitando = !!status && /TRAMITA|MOVIMENTO/i.test(status);
  const urlProcesso = str(p.urlProcesso);

  return (
    <div className="divide-y divide-border/60">
      <section className="space-y-4 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {status ? <Badge variant={tramitando ? 'warning' : 'muted'}>{status}</Badge> : null}
            {grau === 2 ? <Badge variant="outline">2º grau</Badge> : null}
            {sp.ramoDireito ? <Badge variant="secondary">{sp.ramoDireito}</Badge> : null}
            {p.eJusticaGratuita ? <Badge variant="outline">Justiça gratuita</Badge> : null}
            {p.ePrioritario ? <Badge variant="outline">Prioritário</Badge> : null}
            {p.eSegredoJustica ? <Badge variant="destructive">Segredo de justiça</Badge> : null}
            {p.eTutelaAntecipada ? <Badge variant="outline">Tutela antecipada</Badge> : null}
          </div>
          {urlProcesso ? (
            <a
              href={urlProcesso}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              <ExternalLinkIcon className="size-3.5" /> Abrir no tribunal
            </a>
          ) : null}
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Info label="Tribunal" value={[tribunal, uf].filter(Boolean).join(' · ') || undefined} />
          <Info label="Órgão julgador" value={str(p.orgaoJulgador)} />
          <Info label="Sistema" value={str(p.sistema)} />
          <Info label="Área" value={str(p.area)} />
          <Info label="Juiz" value={str(p.juiz)} />
          <Info label="Relator" value={str(p.relator)} />
          <Info label="Classe" value={classeLong(p.classeProcessual)} />
          <Info label="Distribuição" value={formatDate(p.dataDistribuicao)} />
          <Info label="Autuação" value={formatDate(p.dataAutuacao)} />
          <Info label="Arquivamento" value={formatDate(sp.dataArquivamento)} />
          <Info label="Trânsito em julgado" value={formatDate(sp.dataTransitoJulgado)} />
          <Info label="Valor da causa" value={formatBRL(p.valorCausa?.valor)} />
          <Info label="Valor da execução" value={formatBRL(sp.valorExecucao?.valor)} />
        </dl>
      </section>

      {assuntos.length > 0 ? (
        <section className="space-y-2 py-5">
          <h4 className="text-xs font-medium uppercase text-muted-foreground">
            Assuntos ({assuntos.length})
          </h4>
          <ul className="space-y-1 text-sm font-light">
            {assuntos.map((a, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: assuntos have no stable ID; list is static
              <li key={`assunto-${i}`} className="flex items-start gap-2">
                <span className={a.ePrincipal ? 'text-foreground' : 'text-muted-foreground'}>
                  {a.titulo ?? '—'}
                </span>
                {a.ePrincipal ? (
                  <Badge variant="outline" className="shrink-0">
                    principal
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="py-5">
        <h4 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
          Partes ({partes.length})
        </h4>
        {partes.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma parte registrada.</p>
        ) : (
          <ul className="space-y-2">
            {partes.map((parte, i) => {
              const doc = partyDoc(parte);
              const lawyers = parte.advogados ?? [];
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: partes have no stable ID; list is static within a single expanded row
                <li key={`parte-${i}`} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {parte.tipo ? <Badge variant="outline">{parte.tipo}</Badge> : null}
                    <span className="font-normal">{parte.nome ?? '—'}</span>
                    {doc ? <span className="text-xs text-muted-foreground">{doc}</span> : null}
                  </div>
                  {lawyers.length > 0 ? (
                    <ul className="ml-4 mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {lawyers.map((adv, j) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: advogados have no stable ID; list is static
                        <li key={`adv-${j}`}>
                          {adv.nome ?? 'Advogado'}
                          {adv.oab?.uf && adv.oab?.numero
                            ? ` — OAB/${adv.oab.uf} ${adv.oab.numero}`
                            : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {julgamentos.length > 0 ? (
        <section className="space-y-2 py-5">
          <h4 className="text-xs font-medium uppercase text-muted-foreground">
            Julgamentos ({julgamentos.length})
          </h4>
          <ul className="space-y-2">
            {julgamentos.map((j, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: julgamentos have no stable ID; list is static
                key={`julg-${i}`}
                className="rounded-lg border border-border/60 bg-card px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-normal">{j.tipoJulgamento ?? '—'}</span>
                  {formatDate(j.dataJulgamento) ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatDate(j.dataJulgamento)}
                    </span>
                  ) : null}
                </div>
                {j.statusJulgamento ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{j.statusJulgamento}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {relacionados.length > 0 ? (
        <section className="space-y-2 py-5">
          <h4 className="text-xs font-medium uppercase text-muted-foreground">
            Processos relacionados ({relacionados.length})
          </h4>
          <ul className="space-y-1 font-mono text-xs text-muted-foreground">
            {relacionados.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: relacionados have no stable ID; list is static
              <li key={`rel-${i}`}>{r.numeroProcesso ?? '—'}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {movimentos.length > 0 ? (
        <section className="space-y-2 py-5">
          <h4 className="text-xs font-medium uppercase text-muted-foreground">
            Movimentos ({movimentos.length})
          </h4>
          <ul className="space-y-1">
            {movimentos.slice(0, 15).map((m, i) => {
              const { date, text } = movementSummary(m);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: movimentos have no stable ID; list is static within a single expanded row
                <li key={`mov-${i}`} className="text-xs">
                  {date ? (
                    <>
                      <span className="font-mono text-muted-foreground">
                        {formatDate(date) ?? date}
                      </span>
                      {' · '}
                    </>
                  ) : null}
                  <span>{text}</span>
                </li>
              );
            })}
            {movimentos.length > 15 ? (
              <li className="text-xs text-muted-foreground">… e mais {movimentos.length - 15}</li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
