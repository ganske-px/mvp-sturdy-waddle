import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

export const metadata = {
  title: 'Access denied — PX Process Check',
};

export default function AccessDeniedPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-24">
      <Card>
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>
            Your account is not on the operator allowlist. Talk to the admin if you believe this is
            a mistake.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/login"
            className={buttonVariants({ variant: 'outline', className: 'w-full' })}
          >
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
