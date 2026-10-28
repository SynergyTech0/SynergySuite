import { redirect } from 'next/navigation';
import { pagePendingMfa } from '@/lib/server-session';
import { pushEnabledFor } from '@/lib/push-mfa';
import PushApprove from './push-approve';

export const dynamic = 'force-dynamic';

export default async function MfaPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const returnTo = sp.return_to ?? '/account';
  const user = await pagePendingMfa();
  if (!user) redirect(`/login?return_to=${encodeURIComponent(returnTo)}`);
  const push = pushEnabledFor(user.email);

  return (
    <div className="center-wrap">
      <div className="card">
        <div className="brand">
          <img className="logo" src="/synergy-mark.png" alt="" width={34} height={34} />
          <h1>Two-factor authentication</h1>
        </div>
        {push && <PushApprove returnTo={returnTo} />}
        <p className="sub">
          {push ? 'Or enter' : 'Enter'} the 6-digit code from your authenticator app, or one of your backup codes.
        </p>
        {sp.error && <div className="error">That code didn&apos;t work. Try again.</div>}
        <form method="POST" action="/api/auth/mfa">
          <input type="hidden" name="return_to" value={returnTo} />
          <label>Verification code</label>
          <input
            name="code" inputMode="text" autoComplete="one-time-code"
            placeholder="123456 or XXXX-XXXX" autoFocus={!push} required
          />
          <button type="submit">Verify</button>
        </form>
        <p className="footer-note"><a href="/api/oidc/logout">Cancel and sign out</a></p>
      </div>
    </div>
  );
}
