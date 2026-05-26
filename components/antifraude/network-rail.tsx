// components/antifraude/network-rail.tsx
import { buttonVariants } from '@/components/ui/button';
import type { SubgraphStats } from '@/lib/graph/subgraph-stats';
import { ArrowRightIcon, BuildingIcon, ScaleIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';

export type NetworkRailProps = {
  stats: SubgraphStats;
  networkHash: string | null;
  canSeeNetwork: boolean;
};

// Snapshot ilustrativo: anel determinístico de nós ao redor do centro.
// Não mapeia arestas reais (apenas conta) — é decorativo, os números abaixo
// são a informação precisa.
function Preview({ stats }: { stats: SubgraphStats }) {
  const total = Math.min(stats.nodes, 8);
  const cx = 110;
  const cy = 70;
  const radius = 48;
  const dots = Array.from({ length: total }, (_, i) => {
    const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    // Primeiros = pessoas (azul), depois empresas (âmbar), resto neutro.
    const fill =
      i < stats.people ? '#3b82f6' : i < stats.people + stats.companies ? '#f59e0b' : '#94a3b8';
    return { x, y, fill, key: i };
  });
  return (
    <svg viewBox="0 0 220 140" className="h-32 w-full" role="img" aria-label="Prévia da rede">
      {dots.map((d) => (
        <line
          key={`l${d.key}`}
          x1={cx}
          y1={cy}
          x2={d.x}
          y2={d.y}
          stroke="currentColor"
          strokeOpacity={0.18}
          strokeWidth={1}
        />
      ))}
      {dots.map((d) => (
        <circle key={`c${d.key}`} cx={d.x} cy={d.y} r={5} fill={d.fill} />
      ))}
      <circle cx={cx} cy={cy} r={9} className="fill-primary" />
    </svg>
  );
}

function StatRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function NetworkRail({ stats, networkHash, canSeeNetwork }: NetworkRailProps) {
  if (!networkHash || !canSeeNetwork) return null;

  const empty = stats.nodes === 0 && stats.edges === 0;

  return (
    <aside className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 lg:sticky lg:top-8 lg:self-start">
      <h2 className="font-heading text-base font-semibold tracking-tight">
        Rede de relacionamentos
      </h2>

      {empty ? (
        <p className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          A rede ainda está sendo construída. Esta área atualiza conforme a análise avança.
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-border/50 bg-muted/20 text-muted-foreground">
            <Preview stats={stats} />
          </div>
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{stats.nodes}</span> nós ·{' '}
            <span className="font-semibold tabular-nums">{stats.edges}</span> conexões
          </p>
          <div className="flex flex-col gap-1.5">
            <StatRow
              icon={<UsersIcon className="size-4" />}
              label="Pessoas (família)"
              value={stats.familyEdges}
            />
            <StatRow
              icon={<BuildingIcon className="size-4" />}
              label="Empresas"
              value={stats.companies}
            />
            <StatRow
              icon={<ScaleIcon className="size-4" />}
              label="Vínculos processuais"
              value={stats.processEdges}
            />
          </div>
        </>
      )}

      <Link
        href={`/network/${encodeURIComponent(networkHash)}`}
        className={buttonVariants({ variant: 'default', size: 'sm' })}
      >
        Abrir rede completa
        <ArrowRightIcon className="ml-1 size-3.5" />
      </Link>
    </aside>
  );
}
