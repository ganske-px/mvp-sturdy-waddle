'use client';

import type { RiskVerdict } from '@/lib/graph/risk-verdict';
import { useEffect, useState } from 'react';
import { type PathBetweenDto, type SubgraphDto, findPathBetween } from './actions';
import { NetworkCanvas } from './network-canvas';
import { NetworkHeader } from './network-header';
import { PathResultPanel } from './path-result-panel';

export function NetworkShell({
  subgraph,
  verdict,
  centerHash,
  deepLinkTarget,
}: {
  subgraph: SubgraphDto;
  verdict: RiskVerdict;
  centerHash: string;
  deepLinkTarget: string | null;
}) {
  const [pathResult, setPathResult] = useState<PathBetweenDto | null>(null);

  // Deep-link "ver caminho até o risco" vindo da tela de resultado (?caminho=hash).
  // biome-ignore lint/correctness/useExhaustiveDependencies: dispara uma vez no mount
  useEffect(() => {
    if (!deepLinkTarget) return;
    let active = true;
    findPathBetween(centerHash, deepLinkTarget).then((r) => {
      if (active) setPathResult(r);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <NetworkHeader
        centerName={subgraph.center?.label.name ?? null}
        centerHash={centerHash}
        verdict={verdict}
        onPath={setPathResult}
      />
      <PathResultPanel result={pathResult} onClear={() => setPathResult(null)} />
      <NetworkCanvas subgraph={subgraph} />
    </>
  );
}
