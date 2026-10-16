'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function CampaignsPage() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [audiences, setAudiences] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', audience_id: '', template_id: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetch('/api/campaigns').then((r) => r.json()).then((d) => Array.isArray(d) && setItems(d));
    fetch('/api/audiences').then((r) => r.json()).then((d) => Array.isArray(d) && setAudiences(d));
    fetch('/api/templates').then((r) => r.json()).then((d) => Array.isArray(d) && setTemplates(d));
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    setErr('');
    if (!form.name || !form.audience_id || !form.template_id) { setErr('Fill in all fields.'); return; }
    setBusy(true);
    const r = await fetch('/api/campaigns', { method: 'POST', body: JSON.stringify(form) });
    const d = await r.json(); setBusy(false);
    if (d.error) setErr(d.error); else router.push(`/campaigns/${d.id}`);
  };

  return (
    <>
      <h1>Campaigns</h1>
      <p className="sub">Send a template to an audience, then track opens &amp; clicks.</p>
      {err && <div className="notice err">{err}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>New campaign</h2>
        <div className="row">
          <div style={{ flex: 2, minWidth: 200 }}><label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="July Newsletter" /></div>
          <div style={{ flex: 1, minWidth: 160 }}><label>Audience</label>
            <select value={form.audience_id} onChange={(e) => setForm({ ...form, audience_id: e.target.value })}>
              <option value="">Select…</option>
              {audiences.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.count ?? 0})</option>)}
            </select></div>
          <div style={{ flex: 1, minWidth: 160 }}><label>Template</label>
            <select value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
              <option value="">Select…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></div>
        </div>
        <div style={{ marginTop: 12 }}><button onClick={create} disabled={busy}>Create campaign</button></div>
        {(audiences.length === 0 || templates.length === 0) &&
          <p className="muted" style={{ fontSize: 13 }}>You need at least one <Link href="/audiences">audience</Link> and one <Link href="/templates">template</Link> first.</p>}
      </div>

      <div className="card">
        {items.length === 0 ? <p className="muted">No campaigns yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Sent</th><th></th></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td><span className={`chip ${c.status === 'sent' ? 'ok' : c.status === 'failed' ? 'danger' : c.status === 'scheduled' ? 'warn' : 'muted'}`}>{c.status}</span></td>
                  <td>{c.sent_count ?? 0}{c.total ? ` / ${c.total}` : ''}</td>
                  <td><Link href={`/campaigns/${c.id}`}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
