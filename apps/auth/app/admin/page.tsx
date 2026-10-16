import { redirect } from 'next/navigation';
import { pageUser } from '@/lib/server-session';
import AdminConsole from './console';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const auth = await pageUser();
  if (!auth) redirect('/login?return_to=%2Fadmin');
  if (auth.user.role !== 'admin') redirect('/account');

  return (
    <>
      <div className="topnav">
        <div className="brand" style={{ marginBottom: 0 }}>
          <img className="logo" src="/synergy-mark.png" alt="" width={34} height={34} />
          <h1>SynergyAuth</h1>
        </div>
        <div className="spacer" />
        <a href="/account">My account</a>
        <a href="/admin" className="active">Admin</a>
        <a href="/api/oidc/logout">Sign out</a>
      </div>
      <div className="page">
        <AdminConsole />
      </div>
    </>
  );
}
