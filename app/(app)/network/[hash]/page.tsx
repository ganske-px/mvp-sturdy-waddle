import { requirePermission } from '@/lib/auth/permissions';
import { getSubgraph } from './actions';
import { NetworkCanvas } from './network-canvas';
import { NetworkHeader } from './network-header';

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
      <NetworkHeader centerName={subgraph.center?.label.name ?? null} />
      <NetworkCanvas subgraph={subgraph} />
    </div>
  );
}
