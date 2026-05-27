// components/antifraude/risk-verdict-banner.tsx
import { buttonVariants } from '@/components/ui/button';
import type { RiskVerdict } from '@/lib/graph/risk-verdict';
import { AlertTriangleIcon, ArrowRightIcon, ShieldAlertIcon } from 'lucide-react';
import Link from 'next/link';

function riskNoun(v: RiskVerdict): string {
  if (v.isPep && v.hasSanction) return 'pessoa PEP e sancionada';
  if (v.isPep) return 'pessoa PEP';
  return 'pessoa/empresa sancionada';
}

export function RiskVerdictBanner({
  verdict,
  networkHash,
}: {
  verdict: RiskVerdict;
  networkHash: string | null;
}) {
  if (verdict.level === 'none' || !networkHash) return null;

  const direct = verdict.level === 'direct';
  const tone = direct
    ? 'border-destructive/40 bg-destructive/10 text-destructive'
    : 'border-warning/40 bg-warning/10 text-warning-foreground';
  const Icon = direct ? ShieldAlertIcon : AlertTriangleIcon;
  const title = direct
    ? `Relação direta com ${riskNoun(verdict)}`
    : `A ${verdict.distance} saltos de ${riskNoun(verdict)}`;

  const href = verdict.targetHash
    ? `/network/${encodeURIComponent(networkHash)}?caminho=${encodeURIComponent(verdict.targetHash)}`
    : `/network/${encodeURIComponent(networkHash)}`;

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${tone}`} role="alert">
      <Icon className="size-5 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs opacity-80">Vínculo identificado na rede de relacionamentos.</p>
      </div>
      <Link href={href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        Ver caminho
        <ArrowRightIcon className="ml-1 size-3.5" />
      </Link>
    </div>
  );
}
