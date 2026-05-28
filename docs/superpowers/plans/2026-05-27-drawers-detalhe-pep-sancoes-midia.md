# Drawers de detalhe (PEP/Sanções e Mídia) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar drawers laterais nos cards de antifraude (PEP/Sanções CPF, Mídia, Sanções CNPJ) que listam todos os registros do payload Netrin com detalhe suficiente para o operador avaliá-los.

**Architecture:** Parsers puros em `lib/netrin/parsers/` (TDD) extraem os arrays de registros do payload já decifrado; um primitivo `Sheet` (base-ui Dialog ancorado à direita) e três client components renderizam os drawers; `page.tsx` chama os parsers e injeta os registros como props nos cards, que disparam os drawers. Sem lazy-load nem paginação (MVP).

**Tech Stack:** Next.js 16 RSC, React 19, `@base-ui/react/dialog`, Tailwind 4, Vitest.

---

### Task 1: Primitivo `Sheet` (drawer lateral)

**Files:**
- Create: `components/ui/sheet.tsx`

- [ ] **Step 1: Criar o componente Sheet**

```tsx
'use client';

import { Dialog as SheetPrimitive } from '@base-ui/react/dialog';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { XIcon } from 'lucide-react';

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({ className, children, ...props }: SheetPrimitive.Popup.Props) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 duration-150 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-xl flex-col gap-4 overflow-y-auto border-l border-border/60 bg-popover p-5 text-sm text-popover-foreground shadow-elevated outline-none duration-150 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right',
          className,
        )}
        {...props}
      >
        <SheetPrimitive.Close
          render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />}
        >
          <XIcon />
          <span className="sr-only">Fechar</span>
        </SheetPrimitive.Close>
        {children}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-header" className={cn('flex flex-col gap-1 pr-8', className)} {...props} />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-heading text-base font-medium leading-none', className)}
      {...props}
    />
  );
}

export { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger };
```

- [ ] **Step 2: Verificar typecheck/lint**

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add components/ui/sheet.tsx
git commit -m "feat(ui): sheet (drawer lateral) sobre base-ui dialog"
```

---

### Task 2: Parser de sanções (`extractSanctions`)

**Files:**
- Create: `lib/netrin/parsers/sanctions-detail.ts`
- Test: `lib/netrin/parsers/sanctions-detail.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import { extractSanctions } from './sanctions-detail';

describe('extractSanctions', () => {
  it('mapeia sanctionsHistory e ordena por matchRate desc', () => {
    const payload = {
      pepKyc: {
        sanctionsHistory: [
          {
            source: 'ofac',
            type: 'Money Laundering',
            standardizedSanctionType: 'FINANCIAL CRIMES',
            matchRate: 26,
            currentlyPresentOnSource: true,
            lastUpdateDate: '2026-05-27T00:00:00',
            details: { OriginalName: 'LUCAS ANTONIO DE MELO', SanctionName: 'RAMON QUINTERO' },
          },
          {
            source: 'interpol',
            type: 'Law Enforcement',
            standardizedSanctionType: 'ARREST WARRANTS',
            matchRate: 52,
            currentlyPresentOnSource: true,
            lastUpdateDate: '2026-05-26T03:09:25.25',
            details: {
              OriginalName: 'LUCAS ANTONIO DE MELO',
              SanctionName: 'LUCAS DE SOUZA DANTAS',
              BirthDate: '1993/07/05',
              Nationalities: 'BRAZIL',
              charges: 'posesión y trafico',
            },
          },
        ],
      },
    } as never;

    const out = extractSanctions(payload);

    expect(out).toHaveLength(2);
    expect(out[0]?.matchRate).toBe(52);
    expect(out[0]?.sanctionName).toBe('LUCAS DE SOUZA DANTAS');
    expect(out[0]?.nationalities).toBe('BRAZIL');
    expect(out[0]?.charges).toBe('posesión y trafico');
    expect(out[1]?.matchRate).toBe(26);
  });

  it('retorna [] quando não há sanctionsHistory', () => {
    expect(extractSanctions({} as never)).toEqual([]);
    expect(extractSanctions({ pepKyc: {} } as never)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `pnpm test -- lib/netrin/parsers/sanctions-detail`
Expected: FAIL (`extractSanctions is not a function` / módulo não encontrado).

- [ ] **Step 3: Implementar o parser**

```ts
// lib/netrin/parsers/sanctions-detail.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types.ts';

export type SanctionMatch = {
  source: string;
  type?: string;
  standardizedType?: string;
  matchRate: number;
  currentlyPresent: boolean;
  startDate?: string;
  endDate?: string;
  lastUpdateDate?: string;
  originalName?: string;
  sanctionName?: string;
  birthDate?: string;
  nationalities?: string;
  charges?: string;
};

type RawSanction = {
  source?: unknown;
  type?: unknown;
  standardizedSanctionType?: unknown;
  matchRate?: unknown;
  currentlyPresentOnSource?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  lastUpdateDate?: unknown;
  details?: Record<string, unknown> | null;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export function extractSanctions(payload: NetrinCompositePayload): SanctionMatch[] {
  const pep = (payload as Record<string, unknown>).pepKyc as
    | { sanctionsHistory?: unknown }
    | null
    | undefined;
  const list = pep?.sanctionsHistory;
  if (!Array.isArray(list)) return [];

  return (list as RawSanction[])
    .map((row) => {
      const d = row.details ?? {};
      return {
        source: str(row.source) ?? 'desconhecida',
        type: str(row.type),
        standardizedType: str(row.standardizedSanctionType),
        matchRate: typeof row.matchRate === 'number' ? row.matchRate : 0,
        currentlyPresent: row.currentlyPresentOnSource === true,
        startDate: str(row.startDate),
        endDate: str(row.endDate),
        lastUpdateDate: str(row.lastUpdateDate),
        originalName: str(d.OriginalName),
        sanctionName: str(d.SanctionName),
        birthDate: str(d.BirthDate),
        nationalities: str(d.Nationalities),
        charges: str(d.charges),
      } satisfies SanctionMatch;
    })
    .sort((a, b) => b.matchRate - a.matchRate);
}
```

- [ ] **Step 4: Rodar para confirmar que passa**

Run: `pnpm test -- lib/netrin/parsers/sanctions-detail`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/netrin/parsers/sanctions-detail.ts lib/netrin/parsers/sanctions-detail.test.ts
git commit -m "feat(netrin): parser extractSanctions (sanctionsHistory detalhado)"
```

---

### Task 3: Parser de histórico PEP (`extractPepHistory`)

**Files:**
- Create: `lib/netrin/parsers/pep-detail.ts`
- Test: `lib/netrin/parsers/pep-detail.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import { extractPepHistory } from './pep-detail';

describe('extractPepHistory', () => {
  it('filtra linhas placeholder vazias', () => {
    const payload = {
      pepKyc: {
        historyPEP: [
          { level: '', jobTitle: '', department: '', motive: '', source: '', startDate: '', endDate: '' },
          {
            level: 'Federal',
            jobTitle: 'Deputado',
            department: 'Câmara',
            motive: 'Mandato',
            source: 'TSE',
            startDate: '2019-02-01',
            endDate: '2023-01-31',
          },
        ],
      },
    } as never;

    const out = extractPepHistory(payload);

    expect(out).toHaveLength(1);
    expect(out[0]?.jobTitle).toBe('Deputado');
    expect(out[0]?.department).toBe('Câmara');
  });

  it('retorna [] sem historyPEP', () => {
    expect(extractPepHistory({} as never)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `pnpm test -- lib/netrin/parsers/pep-detail`
Expected: FAIL (módulo não encontrado).

- [ ] **Step 3: Implementar o parser**

```ts
// lib/netrin/parsers/pep-detail.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types.ts';

export type PepHistoryEntry = {
  level?: string;
  jobTitle?: string;
  department?: string;
  motive?: string;
  source?: string;
  startDate?: string;
  endDate?: string;
  lastUpdateDate?: string;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export function extractPepHistory(payload: NetrinCompositePayload): PepHistoryEntry[] {
  const pep = (payload as Record<string, unknown>).pepKyc as
    | { historyPEP?: unknown }
    | null
    | undefined;
  const list = pep?.historyPEP;
  if (!Array.isArray(list)) return [];

  return (list as Record<string, unknown>[])
    .map((row) => ({
      level: str(row.level),
      jobTitle: str(row.jobTitle),
      department: str(row.department),
      motive: str(row.motive),
      source: str(row.source),
      startDate: str(row.startDate),
      endDate: str(row.endDate),
      lastUpdateDate: str(row.lastUpdateDate),
    }))
    .filter((e) => Object.values(e).some((v) => v !== undefined));
}
```

- [ ] **Step 4: Rodar para confirmar que passa**

Run: `pnpm test -- lib/netrin/parsers/pep-detail`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/netrin/parsers/pep-detail.ts lib/netrin/parsers/pep-detail.test.ts
git commit -m "feat(netrin): parser extractPepHistory (historyPEP sem placeholders)"
```

---

### Task 4: Parser de menções de mídia (`extractMediaMentions`)

**Files:**
- Create: `lib/netrin/parsers/media-detail.ts`
- Test: `lib/netrin/parsers/media-detail.test.ts`

Nota: o CPF presente em cada menção é **mascarado** via `mask` de `lib/validators/cpf.ts` antes de sair do servidor (LGPD). As três listas (restritivas/gov/socioambientais) ficam fora deste parser — schema indisponível (vazias no payload real); seus contadores já aparecem no card.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import { extractMediaMentions } from './media-detail';

describe('extractMediaMentions', () => {
  it('mapeia midiasPublicas.midias e mascara o CPF', () => {
    const payload = {
      midiasConsolidado: {
        midiasPublicas: {
          midias: [
            {
              titulo: 'Operação X',
              fonte: 'O Dia',
              data_noticia: '2026.05.20 09:56:35',
              uf: 'DF',
              tipo_suspeita: 'Lavagem de Dinheiro',
              envolvimento: 'fraude bilionária',
              citacao: 'texto integral...',
              dtec_link_noticia: 'https://exemplo/n.htm',
              nome: 'Fulano',
              cpf: '06209832644',
            },
          ],
        },
      },
    } as never;

    const out = extractMediaMentions(payload);

    expect(out).toHaveLength(1);
    expect(out[0]?.titulo).toBe('Operação X');
    expect(out[0]?.fonte).toBe('O Dia');
    expect(out[0]?.tipoSuspeita).toBe('Lavagem de Dinheiro');
    expect(out[0]?.link).toBe('https://exemplo/n.htm');
    expect(out[0]?.citacao).toBe('texto integral...');
    // CPF mascarado — nunca os 11 dígitos em claro
    expect(out[0]?.documentoMascarado).not.toBe('06209832644');
    expect(out[0]?.documentoMascarado).toMatch(/\*/);
  });

  it('retorna [] sem midiasPublicas', () => {
    expect(extractMediaMentions({} as never)).toEqual([]);
    expect(extractMediaMentions({ midiasConsolidado: {} } as never)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `pnpm test -- lib/netrin/parsers/media-detail`
Expected: FAIL (módulo não encontrado).

- [ ] **Step 3: Implementar o parser**

```ts
// lib/netrin/parsers/media-detail.ts
import type { NetrinCompositePayload } from '@/lib/netrin/types.ts';
import { mask as maskCpf } from '@/lib/validators/cpf';

export type MediaMention = {
  titulo?: string;
  fonte?: string;
  dataNoticia?: string;
  uf?: string;
  tipoSuspeita?: string;
  envolvimento?: string;
  citacao?: string;
  link?: string;
  nome?: string;
  documentoMascarado?: string;
};

type RawMidia = {
  titulo?: unknown;
  fonte?: unknown;
  data_noticia?: unknown;
  uf?: unknown;
  tipo_suspeita?: unknown;
  envolvimento?: unknown;
  citacao?: unknown;
  dtec_link_noticia?: unknown;
  nome?: unknown;
  cpf?: unknown;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export function extractMediaMentions(payload: NetrinCompositePayload): MediaMention[] {
  const consolidado = (payload as Record<string, unknown>).midiasConsolidado as
    | { midiasPublicas?: { midias?: unknown } }
    | null
    | undefined;
  const list = consolidado?.midiasPublicas?.midias;
  if (!Array.isArray(list)) return [];

  return (list as RawMidia[]).map((m) => {
    const cpfRaw = typeof m.cpf === 'string' ? m.cpf.replace(/\D/g, '') : '';
    return {
      titulo: str(m.titulo),
      fonte: str(m.fonte),
      dataNoticia: str(m.data_noticia),
      uf: str(m.uf),
      tipoSuspeita: str(m.tipo_suspeita),
      envolvimento: str(m.envolvimento),
      citacao: str(m.citacao),
      link: str(m.dtec_link_noticia),
      nome: str(m.nome),
      documentoMascarado: cpfRaw.length === 11 ? maskCpf(cpfRaw) : undefined,
    } satisfies MediaMention;
  });
}
```

- [ ] **Step 4: Rodar para confirmar que passa**

Run: `pnpm test -- lib/netrin/parsers/media-detail`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/netrin/parsers/media-detail.ts lib/netrin/parsers/media-detail.test.ts
git commit -m "feat(netrin): parser extractMediaMentions (CPF mascarado)"
```

---

### Task 5: Drawer PEP/Sanções + trigger no `PepCard`

**Files:**
- Create: `components/antifraude/pep-sancoes-drawer.tsx`
- Modify: `components/antifraude/pep-card.tsx`
- Modify: `components/antifraude/types.ts:20-27` (PepCardProps)

- [ ] **Step 1: Criar o drawer**

```tsx
// components/antifraude/pep-sancoes-drawer.tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { PepHistoryEntry } from '@/lib/netrin/parsers/pep-detail';
import type { SanctionMatch } from '@/lib/netrin/parsers/sanctions-detail';
import { useState } from 'react';

function MatchBar({ rate }: { rate: number }) {
  const tone = rate >= 80 ? 'bg-red-500' : rate >= 50 ? 'bg-amber-500' : 'bg-muted-foreground/50';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, rate))}%` }} />
      </div>
      <span className="font-mono text-[0.65rem] tabular-nums text-muted-foreground">{rate}%</span>
    </div>
  );
}

function SanctionItem({ s }: { s: SanctionMatch }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="uppercase">
            {s.source}
          </Badge>
          {s.standardizedType ? (
            <span className="text-muted-foreground">{s.standardizedType}</span>
          ) : null}
        </div>
        <MatchBar rate={s.matchRate} />
      </div>
      <div className="mt-2 grid gap-0.5">
        {s.sanctionName ? (
          <span>
            <span className="text-muted-foreground">Nome na lista:</span>{' '}
            <span className="font-medium">{s.sanctionName}</span>
          </span>
        ) : null}
        {s.birthDate ? (
          <span className="text-muted-foreground">Nascimento: {s.birthDate}</span>
        ) : null}
        {s.nationalities ? (
          <span className="text-muted-foreground">Nacionalidade: {s.nationalities}</span>
        ) : null}
      </div>
      {s.charges ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-[0.65rem] uppercase tracking-wider text-primary hover:underline"
        >
          {open ? 'Ocultar acusações' : 'Ver acusações'}
        </button>
      ) : null}
      {open && s.charges ? (
        <p className="mt-1 whitespace-pre-line text-muted-foreground">{s.charges}</p>
      ) : null}
    </li>
  );
}

export function PepSancoesDrawer({
  sanctions,
  pepHistory,
  confirmedSanction,
}: {
  sanctions: SanctionMatch[];
  pepHistory: PepHistoryEntry[];
  confirmedSanction: boolean;
}) {
  const total = sanctions.length + pepHistory.length;
  if (total === 0) return null;

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="sm" className="self-start text-primary">
            Ver {total} registro{total === 1 ? '' : 's'}
          </Button>
        }
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>PEP / Sanções — registros</SheetTitle>
        </SheetHeader>

        {!confirmedSanction && sanctions.length > 0 ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
            Correspondências por <strong>similaridade de nome</strong> — não confirmam sanção.
            Avalie nome, data de nascimento e nacionalidade antes de concluir.
          </p>
        ) : null}

        {pepHistory.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Exposição política (PEP)
            </h3>
            <ul className="flex flex-col gap-2">
              {pepHistory.map((p, i) => (
                <li
                  key={`pep-${i}`}
                  className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs"
                >
                  <span className="font-medium">{p.jobTitle ?? 'Cargo não informado'}</span>
                  {p.department ? (
                    <span className="text-muted-foreground"> · {p.department}</span>
                  ) : null}
                  <div className="mt-1 grid gap-0.5 text-muted-foreground">
                    {p.motive ? <span>Motivo: {p.motive}</span> : null}
                    {p.source ? <span>Fonte: {p.source}</span> : null}
                    {p.startDate || p.endDate ? (
                      <span>
                        Período: {p.startDate ?? '?'} — {p.endDate ?? 'atual'}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {sanctions.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Correspondências em listas ({sanctions.length})
            </h3>
            <ul className="flex flex-col gap-2">
              {sanctions.map((s, i) => (
                <SanctionItem key={`s-${i}`} s={s} />
              ))}
            </ul>
          </section>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Adicionar props em `PepCardProps`**

Em `components/antifraude/types.ts`, substituir o bloco `PepCardProps` (linhas 20-27) por:

```ts
import type { PepHistoryEntry } from '@/lib/netrin/parsers/pep-detail';
import type { SanctionMatch } from '@/lib/netrin/parsers/sanctions-detail';

export type PepCardProps = {
  status: AntifraudeStatus;
  currentlyPEP?: boolean;
  currentlySanctioned?: boolean;
  previouslySanctioned?: boolean;
  historicoCount?: number;
  sanctions?: SanctionMatch[];
  pepHistory?: PepHistoryEntry[];
  bare?: boolean;
};
```

(O `import type` vai para o topo do arquivo; o Biome reordena com `pnpm lint:fix`.)

- [ ] **Step 3: Renderizar o drawer no `PepCard`**

Em `components/antifraude/pep-card.tsx`: importar o drawer e desestruturar as novas props. No topo:

```tsx
import { PepSancoesDrawer } from './pep-sancoes-drawer';
```

Atualizar a assinatura para incluir `sanctions = [], pepHistory = [], currentlySanctioned` (já existe) e inserir o drawer no fim do `body` de sucesso — logo após o bloco `<div>Histórico...</div>`, dentro do mesmo fragmento:

```tsx
      <div>
        <span className="text-muted-foreground">Histórico:</span> {historicoCount ?? 0} registros
      </div>
      <PepSancoesDrawer
        sanctions={sanctions}
        pepHistory={pepHistory}
        confirmedSanction={!!currentlySanctioned}
      />
```

- [ ] **Step 4: Verificar typecheck/lint**

Run: `pnpm lint:fix && pnpm typecheck`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add components/antifraude/pep-sancoes-drawer.tsx components/antifraude/pep-card.tsx components/antifraude/types.ts
git commit -m "feat(antifraude): drawer PEP/Sanções com matchRate e aviso de homônimo"
```

---

### Task 6: Drawer de Mídia + trigger no `MediaCard`

**Files:**
- Create: `components/antifraude/media-drawer.tsx`
- Modify: `components/antifraude/media-card.tsx`
- Modify: `components/antifraude/types.ts` (MediaCardProps)

- [ ] **Step 1: Criar o drawer**

```tsx
// components/antifraude/media-drawer.tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { MediaMention } from '@/lib/netrin/parsers/media-detail';
import { useState } from 'react';

function MentionItem({ m }: { m: MediaMention }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{m.titulo ?? 'Sem título'}</span>
        {m.tipoSuspeita ? (
          <Badge variant="destructive" className="shrink-0">
            {m.tipoSuspeita}
          </Badge>
        ) : null}
      </div>
      <div className="mt-1 text-muted-foreground">
        {[m.fonte, m.dataNoticia, m.uf].filter(Boolean).join(' · ')}
      </div>
      {m.envolvimento ? <p className="mt-1 text-muted-foreground">{m.envolvimento}</p> : null}
      {m.citacao ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 text-[0.65rem] uppercase tracking-wider text-primary hover:underline"
          >
            {open ? 'Ocultar matéria' : 'Ler matéria'}
          </button>
          {open ? (
            <p className="mt-1 whitespace-pre-line text-muted-foreground">{m.citacao}</p>
          ) : null}
        </>
      ) : null}
      {m.link ? (
        <a
          href={m.link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block text-[0.65rem] uppercase tracking-wider text-primary hover:underline"
        >
          Ler na fonte ↗
        </a>
      ) : null}
    </li>
  );
}

export function MediaDrawer({ mentions }: { mentions: MediaMention[] }) {
  if (mentions.length === 0) return null;
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="sm" className="self-start text-primary">
            Ver {mentions.length} menç{mentions.length === 1 ? 'ão' : 'ões'}
          </Button>
        }
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Menções na mídia ({mentions.length})</SheetTitle>
        </SheetHeader>
        <ul className="flex flex-col gap-2">
          {mentions.map((m, i) => (
            <MentionItem key={`m-${i}`} m={m} />
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Adicionar prop em `MediaCardProps`**

Em `components/antifraude/types.ts`, no bloco `MediaCardProps`, adicionar:

```ts
import type { MediaMention } from '@/lib/netrin/parsers/media-detail';

export type MediaCardProps = {
  status: AntifraudeStatus;
  mencoes?: number;
  qtdMidias?: number;
  qtdListas?: number;
  qtdGov?: number;
  qtdAmb?: number;
  mentions?: MediaMention[];
  bare?: boolean;
};
```

- [ ] **Step 3: Renderizar o drawer no `MediaCard`**

Em `components/antifraude/media-card.tsx`: importar `import { MediaDrawer } from './media-drawer';`, desestruturar `mentions = []` na assinatura, e inserir `<MediaDrawer mentions={mentions} />` logo após o `<ul>` de contadores (dentro do fragmento de sucesso).

- [ ] **Step 4: Verificar typecheck/lint**

Run: `pnpm lint:fix && pnpm typecheck`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add components/antifraude/media-drawer.tsx components/antifraude/media-card.tsx components/antifraude/types.ts
git commit -m "feat(antifraude): drawer de mídia com citação expansível e link à fonte"
```

---

### Task 7: Drawer de Sanções CNPJ + trigger no `SancoesCardCnpj`

**Files:**
- Create: `components/antifraude/sancoes-cnpj-drawer.tsx`
- Modify: `components/antifraude/sancoes-card-cnpj.tsx`

Os dados (`ceis[]`, `cnep[]`, `trabalhoEscravo`) já chegam ao card via props — sem parser novo.

- [ ] **Step 1: Criar o drawer**

```tsx
// components/antifraude/sancoes-cnpj-drawer.tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

type SancaoItem = { ativo: boolean; descricao?: string };

function SancaoList({ titulo, itens }: { titulo: string; itens: SancaoItem[] }) {
  if (itens.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo} ({itens.length})
      </h3>
      <ul className="flex flex-col gap-2">
        {itens.map((c, i) => (
          <li
            key={`${titulo}-${i}`}
            className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs"
          >
            <Badge variant={c.ativo ? 'destructive' : 'secondary'}>
              {c.ativo ? 'Ativa' : 'Encerrada'}
            </Badge>
            {c.descricao ? <p className="mt-1 text-muted-foreground">{c.descricao}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SancoesCnpjDrawer({
  ceis,
  cnep,
  trabalhoEscravo,
}: {
  ceis: SancaoItem[];
  cnep: SancaoItem[];
  trabalhoEscravo?: boolean;
}) {
  const total = ceis.length + cnep.length;
  if (total === 0 && !trabalhoEscravo) return null;
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="sm" className="self-start text-primary">
            Ver registros
          </Button>
        }
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Sanções e restrições — registros</SheetTitle>
        </SheetHeader>
        {trabalhoEscravo ? (
          <p className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs">
            Presença em lista de <strong>trabalho escravo</strong>.
          </p>
        ) : null}
        <SancaoList titulo="CEIS" itens={ceis} />
        <SancaoList titulo="CNEP" itens={cnep} />
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Renderizar o drawer no `SancoesCardCnpj`**

Em `components/antifraude/sancoes-card-cnpj.tsx`: importar `import { SancoesCnpjDrawer } from './sancoes-cnpj-drawer';` e, no ramo de sucesso do `body` (o `<div className="flex flex-wrap gap-1">` com os badges), envolver num fragmento e adicionar o drawer logo depois:

```tsx
    ) : (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {sancionado ? <Badge variant="destructive">Sancionado</Badge> : null}
          {ceisAtivos > 0 ? <Badge variant="destructive">CEIS: {ceisAtivos} ativo(s)</Badge> : null}
          {cnepAtivos > 0 ? <Badge variant="destructive">CNEP: {cnepAtivos} ativo(s)</Badge> : null}
          {trabalhoEscravo ? <Badge variant="destructive">Trabalho escravo</Badge> : null}
        </div>
        <SancoesCnpjDrawer ceis={ceis ?? []} cnep={cnep ?? []} trabalhoEscravo={trabalhoEscravo} />
      </div>
    );
```

- [ ] **Step 3: Verificar typecheck/lint**

Run: `pnpm lint:fix && pnpm typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add components/antifraude/sancoes-cnpj-drawer.tsx components/antifraude/sancoes-card-cnpj.tsx
git commit -m "feat(antifraude): drawer de sanções CNPJ (CEIS/CNEP detalhado)"
```

---

### Task 8: Plumbing em `page.tsx` (injetar registros nos cards)

**Files:**
- Modify: `app/(app)/search/result/[hash]/page.tsx`

- [ ] **Step 1: Importar os parsers**

No topo de `page.tsx`, adicionar:

```tsx
import { extractMediaMentions } from '@/lib/netrin/parsers/media-detail';
import { extractPepHistory } from '@/lib/netrin/parsers/pep-detail';
import { extractSanctions } from '@/lib/netrin/parsers/sanctions-detail';
```

- [ ] **Step 2: Construir os registros junto aos props existentes**

Logo após a linha `const cnpjMediaProps = cnpjRootPayload ? extractMediaFromHop1(cnpjRootPayload) : null;` (≈ linha 476), adicionar:

```tsx
  const pepSanctions = hop1 ? extractSanctions(hop1) : [];
  const pepHistory = hop1 ? extractPepHistory(hop1) : [];
  const mediaMentions = hop1 ? extractMediaMentions(hop1) : [];
  const cnpjMediaMentions = cnpjRootPayload ? extractMediaMentions(cnpjRootPayload) : [];
```

- [ ] **Step 3: Passar os registros para os cards CPF**

No `<MediaCard>` do ramo CPF (≈ linha 608) adicionar a prop `mentions={mediaMentions}`.
No `<PepCard>` (≈ linha 624) adicionar `sanctions={pepSanctions}` e `pepHistory={pepHistory}`.

- [ ] **Step 4: Passar os registros para o card CNPJ**

No `<MediaCard>` do ramo CNPJ (≈ linha 672) adicionar `mentions={cnpjMediaMentions}`.
(O `<SancoesCardCnpj>` já recebe `ceis`/`cnep`/`trabalhoEscravo` — nada a mudar.)

- [ ] **Step 5: Verificar build/typecheck/lint**

Run: `pnpm lint:fix && pnpm typecheck`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/search/result/[hash]/page.tsx"
git commit -m "feat(result): injeta registros de sanções/PEP/mídia nos cards"
```

---

### Task 9: Verificação final

**Files:** nenhum (verificação).

- [ ] **Step 1: Suite completa + typecheck + lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: todos verdes; contagem de testes ≥ 386 + 6 novos.

- [ ] **Step 2: Smoke manual**

Run: `pnpm dev`
Abrir um resultado de CPF com sanções/mídia e um de CNPJ com CEIS/CNEP. Verificar:
- Botão "Ver N registros" / "Ver menções" abre o drawer à direita.
- Drawer de sanções mostra matchRate e o aviso de similaridade quando `currentlySanctioned=Não`.
- Drawer de mídia expande a citação e abre o link da fonte.
- Nenhum CPF em claro nos registros de mídia (deve aparecer mascarado).

- [ ] **Step 3: Commit final (se houve ajuste no smoke)**

```bash
git add -A
git commit -m "chore(antifraude): ajustes do smoke dos drawers"
```

---

## Notas de escopo

- As listas restritivas/governamentais/socioambientais de mídia ficam representadas
  apenas pelos contadores no card (schema indisponível — vazias no payload real).
  Quando surgir um payload com essas listas preenchidas, estender `media-detail.ts`
  com TDD e adicionar seções no `MediaDrawer`.
- Sem lazy-load/paginação: `citacao` integral vai ao cliente (expansível inline),
  conforme decisão de produto.
