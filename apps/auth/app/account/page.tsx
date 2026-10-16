import { redirect } from 'next/navigation';
import { pageUser } from '@/lib/server-session';
import { b } from '@/lib/users';
import { isDemoUser } from '@/lib/config';
import AccountPanels from './panels';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const auth = await pageUser();
  if (!auth) redirect('/login?return_to=%2Faccount');
  const { user } = auth;
  const demo = isDemoUser(user.email);

  return (
    <>
      <div className="topnav">
        <div className="brand" style={{ marginBottom: 0 }}>
          <img className="logo" src="/synergy-mark.png" alt="" width={34} height={34} />
          <h1>SynergyAuth</h1>
        </div>
        <div className="spacer" />
        <a href="/account" className="active">My account</a>
        {user.role === 'admin' && <a href="/admin">Admin</a>}
        <a href="/api/oidc/logout">Sign out</a>
      </div>
      <div className="page">
        <div className="panel">
          <h2>Signed in as</h2>
          <p style={{ fontSize: 14 }}>
            {user.name ?? user.email} — <code className="k">{user.email}</code>{' '}
            <span className={`pill ${user.role === 'admin' ? 'on' : 'off'}`}>{user.role}</span>{' '}
            <span className={`pill ${b(user.mfa_enabled) ? 'on' : 'bad'}`}>
              {b(user.mfa_enabled) ? 'MFA enabled' : 'MFA off'}
            </span>
          </p>
        </div>
        {demo && (
          <div className="notice">
            This is the shared demo account: its password, two-step verification and passkeys can&apos;t be changed.
          </div>
        )}
        <AccountPanels mfaEnabled={b(user.mfa_enabled)} demo={demo} />
      </div>
    </>
  );
}
