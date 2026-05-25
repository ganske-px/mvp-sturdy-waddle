import { buttonVariants } from '@/components/ui/button';
import Link from 'next/link';

export function NetworkCta({
  networkHash,
  canSeeNetwork,
}: {
  networkHash: string | null | undefined;
  canSeeNetwork: boolean;
}) {
  if (!networkHash || !canSeeNetwork) return null;
  return (
    <Link
      href={`/network/${encodeURIComponent(networkHash)}`}
      className={buttonVariants({ variant: 'outline', size: 'sm' })}
    >
      Ver rede
    </Link>
  );
}
