import type { PredictusProcess } from '@/lib/predictus/types';
import { mask as maskCnpj } from '@/lib/validators/cnpj';
import { mask as maskCpf } from '@/lib/validators/cpf';

type Party = {
  tipo?: string;
  nome?: string;
  cpf?: string;
  cnpj?: string;
  advogados?: Array<{
    nome?: string;
    oab?: { uf?: string; numero?: string };
  }>;
};

type MaybeMovement = {
  dataMovimento?: string;
  data?: string;
  descricao?: string;
  texto?: string;
  nome?: string;
};

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

function tribunalLong(t: PredictusProcess['tribunal']): string {
  if (!t) return '—';
  if (typeof t === 'object') return t.nome ?? t.sigla ?? '—';
  return t;
}

function classeLong(c: PredictusProcess['classeProcessual']): string {
  if (!c) return '—';
  if (typeof c === 'object') {
    return c.codigoCNJ ? `${c.nome ?? '—'} (CNJ ${c.codigoCNJ})` : (c.nome ?? '—');
  }
  return c;
}

export function ProcessDetail({ process: p }: { process: PredictusProcess }) {
  const partes = (p.partes ?? []) as Party[];
  const movimentos = (p.movimentos ?? []) as MaybeMovement[];

  return (
    <div className="space-y-4 px-1 py-2">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2 md:grid-cols-3">
        <div>
          <dt className="font-medium uppercase text-muted-foreground">Tribunal</dt>
          <dd className="mt-0.5">{tribunalLong(p.tribunal)}</dd>
        </div>
        <div className="md:col-span-2">
          <dt className="font-medium uppercase text-muted-foreground">Classe</dt>
          <dd className="mt-0.5">{classeLong(p.classeProcessual)}</dd>
        </div>
      </dl>

      <section>
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
                  <div>
                    <span className="font-medium">{parte.tipo ?? '—'}</span>
                    {' · '}
                    <span>{parte.nome ?? '—'}</span>
                    {doc ? <span className="text-xs text-muted-foreground"> · {doc}</span> : null}
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

      <section>
        <h4 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
          Movimentos ({movimentos.length})
        </h4>
        {movimentos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem movimentos registrados.</p>
        ) : (
          <ul className="space-y-1">
            {movimentos.slice(0, 15).map((m, i) => {
              const { date, text } = movementSummary(m);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: movimentos have no stable ID; list is static within a single expanded row
                <li key={`mov-${i}`} className="text-xs">
                  {date ? (
                    <>
                      <span className="font-mono text-muted-foreground">{date}</span>
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
        )}
      </section>
    </div>
  );
}
