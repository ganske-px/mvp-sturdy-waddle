import { requirePermission } from '@/lib/auth/permissions';
import { getSubgraph } from './actions';
import { NetworkCanvas } from './network-canvas';

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
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Rede</h1>
      <NetworkCanvas subgraph={subgraph} />
    </div>
  );
}
