import { redirect } from 'next/navigation';
import { currentAccess } from '@/lib/session';
import { AuthShell } from '@/components/auth-shell';
import { SuiteBar } from '@/components/suite-bar';

export const dynamic = 'force-dynamic';

/**
 * Shown to anyone who reaches Trust without access: either no suite identity arrived with
 * the request, or the person is signed in to the suite but nobody has added them to an
 * organisation here. Neither case reveals which organisations exist.
 */
export default async function NoAccessPage() {
  const access = await currentAccess();
  if (access.state === 'ready') redirect('/');

  if (access.state === 'anonymous') {
    return (
      <AuthShell title="Sign in to the suite" sub="Trust uses your Synergy account.">
        <p className="text-sm text-ink-2">
          No signed-in suite user reached Trust. Open it through the suite so the sign-in
          gateway can identify you. For local development, set{' '}
          <code className="hash">DEV_USER_EMAIL</code>.
        </p>
      </AuthShell>
    );
  }

  return (
    <>
      <SuiteBar user={access.email} domain={process.env.SUITE_DOMAIN} />
      <AuthShell title="No access yet" sub={`Signed in as ${access.email}.`}>
        {access.suspended ? (
          <p className="text-sm text-ink-2">
            Your access to Trust has been suspended. Ask an administrator of your
            organisation if you think this is a mistake.
          </p>
        ) : (
          <p className="text-sm text-ink-2">
            You are not a member of any organisation in Trust. Ask an owner or admin of your
            organisation to add you by email; you will have access the next time you open
            Trust.
          </p>
        )}
      </AuthShell>
    </>
  );
}
