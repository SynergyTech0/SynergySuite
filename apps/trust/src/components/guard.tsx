import { redirect } from 'next/navigation';
import { currentAccess, ForbiddenError, type ReadySession } from '@/lib/session';
import { Card } from './ui';

/**
 * The session for a page, or a redirect to the page that explains why there is none:
 * either no suite identity reached the app, or the person is signed in to the suite but
 * nobody has added them to an organisation here.
 */
export async function pageSession(): Promise<ReadySession> {
  const access = await currentAccess();
  if (access.state !== 'ready') redirect('/no-access');
  return access.session;
}

/** Renders instead of a page when the session's role is not permitted to see it. */
export function Forbidden({ message }: { message: string }) {
  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-ink">Not permitted</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">{message}</p>
    </Card>
  );
}

export { ForbiddenError };
