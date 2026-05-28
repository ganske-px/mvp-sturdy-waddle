import { requirePermission } from '@/lib/auth/permissions';
import { getRiskVerdict } from '@/lib/graph/risk-verdict';
import { getSubgraph } from './actions';
import { NetworkBreadcrumb } from './network-breadcrumb';
import { NetworkShell } from './network-shell';

export const metadata = {
  title: 'Rede — Radar PX',
};

export default async function NetworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ hash: string }>;
  searchParams: Promise<{ caminho?: string; origem?: string }>;
}) {
  await requirePermission('search_network');
  const { hash } = await params;
  const { caminho, origem } = await searchParams;
  const decoded = decodeURIComponent(hash);
  const subgraph = await getSubgraph(decoded);
  const verdict = await getRiskVerdict(decoded);

  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-6 py-8">
      <NetworkBreadcrumb
        originPath={origem ? decodeURIComponent(origem) : null}
        centerHash={decoded}
      />
      <NetworkShell
        subgraph={subgraph}
        verdict={verdict}
        centerHash={decoded}
        deepLinkTarget={caminho ? decodeURIComponent(caminho) : null}
      />
    </main>
  );
}
