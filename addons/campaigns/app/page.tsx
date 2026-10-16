import Link from 'next/link';
import { listAudiences, listCampaigns, listTemplates } from '@/lib/repo';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  let audiences: any[] = [], campaigns: any[] = [], templates: any[] = [];
  let dbError = '';
  try {
    [audiences, campaigns, templates] = await Promise.all([
      listAudiences(), listCampaigns(), listTemplates(),
    ]);
  } catch (e: any) {
    dbError = e.message;
  }
  const contacts = audiences.reduce((n, a) => n + (a.count ?? 0), 0);
  const sent = campaigns.filter((c) => c.status === 'sent').length;

  return (
    <>
      <h1>Dashboard</h1>
      <p className="sub">Marketing email platform — contacts, templates, campaigns &amp; automations on SynergyDB.</p>

      {dbError && (
        <div className="notice err">Can&apos;t reach SynergyDB: {dbError}. Check that it&apos;s running on the
          port in <small className="code">DATABASE_URL</small>.</div>
      )}

      <div className="grid">
        <div className="card stat"><div className="n">{contacts}</div><div className="l">Subscribed contacts</div></div>
        <div className="card stat"><div className="n">{audiences.length}</div><div className="l">Audiences</div></div>
        <div className="card stat"><div className="n">{templates.length}</div><div className="l">Templates</div></div>
        <div className="card stat"><div className="n">{sent}</div><div className="l">Campaigns sent</div></div>
      </div>

      <h2>Recent campaigns</h2>
      <div className="card">
        {campaigns.length === 0 ? (
          <p className="muted">No campaigns yet. <Link href="/campaigns">Create one →</Link></p>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Sent</th></tr></thead>
            <tbody>
              {campaigns.slice(0, 6).map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/campaigns/${c.id}`}>{c.name}</Link></td>
                  <td><span className={`chip ${c.status === 'sent' ? 'ok' : c.status === 'failed' ? 'danger' : 'muted'}`}>{c.status}</span></td>
                  <td>{c.sent_count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="muted" style={{ fontSize: 13 }}>
        Quick start: create an <Link href="/audiences">audience</Link> → import contacts →
        build a <Link href="/templates">template</Link> → launch a <Link href="/campaigns">campaign</Link>.
      </p>
    </>
  );
}
