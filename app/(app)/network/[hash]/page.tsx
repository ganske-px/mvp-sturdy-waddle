import { requirePermission } from '@/lib/auth/permissions';
import { getSubgraph } from './actions';
import { NetworkCanvas } from './network-canvas';
import { NetworkHeader } from './network-header';

export const metadata = {
  title: 'Rede — Radar PX',
};

export default async function NetworkPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  await requirePermission('search_network');
  const { hash } = await params;
  const decoded = decodeURIComponent(hash);
  const subgraph = await getSubgraph(decoded);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12">
      <NetworkHeader centerName={subgraph.center?.label.name ?? null} />
      <NetworkCanvas subgraph={subgraph} />
    </main>
  );
}
