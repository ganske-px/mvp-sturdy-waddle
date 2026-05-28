'use client';

import { signOut } from '@/app/sign-out/actions';
import { Button } from '@/components/ui/button';
import { LogOutIcon } from 'lucide-react';
import { useTransition } from 'react';

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await signOut();
        });
      }}
    >
      <LogOutIcon className="size-3.5" />
      {isPending ? 'Saindo…' : 'Sair'}
    </Button>
  );
}
