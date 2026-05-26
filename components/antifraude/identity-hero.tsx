import { FamilyChips } from '@/components/antifraude/family-chips';
import { Badge } from '@/components/ui/badge';
import { Loader2Icon } from 'lucide-react';
import type { RelatedPersonEntry } from './types';

type RiskDot = { label: string; active: boolean };

type CommonProps = {
  termPreview: string;
  situacaoCadastral?: string;
  jobRunning: boolean;
  risk: RiskDot[];
};

export type IdentityHeroProps =
  | (CommonProps & {
      tipo: 'cpf';
      nome?: string;
      idade?: number;
      genero?: string;
      nomeMae?: string;
      nucleo: RelatedPersonEntry[];
      parentCpfHash: string;
      currentPath?: string;
    })
  | (CommonProps & {
      tipo: 'cnpj';
      razaoSocial?: string;
      nomeFantasia?: string;
      capitalSocial?: number;
      atividadePrincipal?: string;
      dataAbertura?: string;
    });

function SituacaoPill({ situacao }: { situacao?: string }) {
  if (!situacao) return null;
  const ativa =
    situacao.toLowerCase().includes('ativa') || situacao.toLowerCase().includes('regular');
  return <Badge variant={ativa ? 'success' : 'destructive'}>{situacao}</Badge>;
}

function RiskRow({ risk }: { risk: RiskDot[] }) {
  if (risk.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {risk.map((r) => (
        <span key={r.label} className="flex items-center gap-1.5">
          <span
            className={`size-2 rounded-full ${r.active ? 'bg-destructive' : 'bg-emerald-500/70'}`}
            aria-hidden
          />
          <span className={r.active ? 'font-medium text-destructive' : 'text-muted-foreground'}>
            {r.label}
          </span>
        </span>
      ))}
    </div>
  );
}

export function IdentityHero(props: IdentityHeroProps) {
  const title =
    props.tipo === 'cpf'
      ? (props.nome ?? props.termPreview)
      : (props.razaoSocial ?? props.termPreview);

  const meta =
    props.tipo === 'cpf'
      ? [
          typeof props.idade === 'number' ? `${props.idade} anos` : null,
          props.genero,
          props.termPreview,
        ].filter(Boolean)
      : [
          props.nomeFantasia,
          typeof props.capitalSocial === 'number'
            ? props.capitalSocial.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            : null,
          props.termPreview,
        ].filter(Boolean);

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{meta.join(' · ')}</p>
        </div>
        <div className="flex items-center gap-3">
          {props.jobRunning ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              Analisando…
            </span>
          ) : null}
          <SituacaoPill situacao={props.situacaoCadastral} />
        </div>
      </div>

      <RiskRow risk={props.risk} />

      {props.tipo === 'cpf' && props.nomeMae ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground/70">Mãe:</span> {props.nomeMae}
        </p>
      ) : null}

      {props.tipo === 'cnpj' && props.atividadePrincipal ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground/70">Atividade:</span>{' '}
          {props.atividadePrincipal}
          {props.dataAbertura ? ` · desde ${props.dataAbertura}` : ''}
        </p>
      ) : null}

      {props.tipo === 'cpf' ? (
        <div className="border-t border-border/60 pt-4">
          <FamilyChips
            people={props.nucleo}
            parentCpfHash={props.parentCpfHash}
            currentPath={props.currentPath}
          />
        </div>
      ) : null}
    </section>
  );
}
