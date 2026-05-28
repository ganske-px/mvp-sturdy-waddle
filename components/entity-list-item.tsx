import type { ReactNode } from 'react';

export type EntityListItemProps = {
  /** Conteúdo à esquerda: título + subtítulos/badges/metadados. */
  children: ReactNode;
  /** Ação à direita (botão "Aprofundar"/"Detalhes"), centralizada na altura do item. */
  action?: ReactNode;
};

/**
 * Item de lista compartilhado entre processos, pessoas, empresas e sócios.
 * Layout uniforme: conteúdo à esquerda, ação à direita, separação por borda
 * superior e realce no hover para identificar a linha sob o cursor.
 */
export function EntityListItem({ children, action }: EntityListItemProps) {
  return (
    <div className="-mx-2 flex items-center justify-between gap-3 rounded-md border-t border-border/60 px-2 py-3.5 transition-colors first:border-t-0 hover:bg-muted/40">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
