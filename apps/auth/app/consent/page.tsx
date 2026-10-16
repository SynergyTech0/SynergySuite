import { redirect } from 'next/navigation';
import { pageUser } from '@/lib/server-session';
import { findClient } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

const SCOPE_LABELS: Record<string, string> = {
  openid: 'Verify your identity',
  profile: 'View your name and role',
  email: 'View your email address',
  offline_access: 'Stay signed in (offline access)',
};

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const returnTo = sp.return_to ?? '';
  const auth = await pageUser();
  if (!auth) redirect(`/login?return_to=${encodeURIComponent(returnTo)}`);
  if (!returnTo.startsWith('/api/oidc/authorize?')) redirect('/account');

  const qs = new URLSearchParams(returnTo.split('?')[1] ?? '');
  const clientId = qs.get('client_id') ?? '';
  const scope = qs.get('scope') ?? 'openid';
  const client = await findClient(clientId);
  if (!client) redirect('/account');

  return (
    <div className="center-wrap">
      <div className="card">
        <div className="brand">
          <img className="logo" src="/synergy-mark.png" alt="" width={34} height={34} />
          <h1>Authorize {client.name}</h1>
        </div>
        <p className="sub">
          <strong>{client.name}</strong> wants to access your SynergyAuth account
          (<code className="k">{auth.user.email}</code>). It will be able to:
        </p>
        <ul style={{ margin: '0 0 8px 18px', fontSize: 14, lineHeight: '26px' }}>
          {scope.split(' ').map((s) => (
            <li key={s}>{SCOPE_LABELS[s] ?? s}</li>
          ))}
        </ul>
        <form method="POST" action="/api/auth/consent">
          <input type="hidden" name="return_to" value={returnTo} />
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="scope" value={scope} />
          <button type="submit" name="decision" value="approve">Allow access</button>
          <button type="submit" name="decision" value="deny" className="secondary">Deny</button>
        </form>
      </div>
    </div>
  );
}
