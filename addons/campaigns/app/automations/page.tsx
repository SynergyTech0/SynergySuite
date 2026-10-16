'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function AutomationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [audiences, setAudiences] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', audience_id: '', template_id: '', delay_min: 0 });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetch('/api/automations').then((r) => r.json()).then((d) => Array.isArray(d) && setItems(d));
    fetch('/api/audiences').then((r) => r.json()).then((d) => Array.isArray(d) && setAudiences(d));
    fetch('/api/templates').then((r) => r.json()).then((d) => Array.isArray(d) && setTemplates(d));
  };
  useEffect(() => { load(); }, []);

  const name = (list: any[], id: string) => list.find((x) => x.id === id)?.name ?? '—';

  const create = async () => {
    setErr('');
    if (!form.name || !form.audience_id || !form.template_id) { setErr('Fill in all fields.'); return; }
    setBusy(true);
    const r = await fetch('/api/automations', { method: 'POST', body: JSON.stringify(form) });
    const d = await r.json(); setBusy(false);
    if (d.error) setErr(d.error); else { setForm({ name: '', audience_id: '', template_id: '', delay_min: 0 }); load(); }
  };

  return (
    <>
      <h1>Automations</h1>
      <p className="sub">Send an email automatically when a contact is added to an audience (e.g. a welcome email).</p>
      {err && <div className="notice err">{err}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>New automation</h2>
        <div className="row">
          <div style={{ flex: 2, minWidth: 180 }}><label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Welcome email" /></div>
          <div style={{ flex: 1, minWidth: 150 }}><label>When contact added to</label>
            <select value={form.audience_id} onChange={(e) => setForm({ ...form, audience_id: e.target.value })}>
              <option value="">Select audience…</option>
              {audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
          <div style={{ flex: 1, minWidth: 150 }}><label>Send template</label>
            <select value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
              <option value="">Select template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></div>
          <div style={{ width: 130 }}><label>Delay (min)</label>
            <input type="number" min={0} value={form.delay_min} onChange={(e) => setForm({ ...form, delay_min: Number(e.target.value) })} /></div>
        </div>
        <div style={{ marginTop: 12 }}><button onClick={create} disabled={busy}>Create automation</button></div>
        <p className="muted" style={{ fontSize: 13 }}>Queued sends fire on the scheduler tick (<small className="code">/api/cron</small>).</p>
      </div>

      <div className="card">
        {items.length === 0 ? <p className="muted">No automations yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Trigger</th><th>Audience</th><th>Template</th><th>Delay</th><th>Active</th></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td><span className="chip">contact added</span></td>
                  <td>{name(audiences, a.audience_id)}</td>
                  <td>{name(templates, a.template_id)}</td>
                  <td>{Number(a.delay_min ?? 0)} min</td>
                  <td><span className={`chip ${a.active ? 'ok' : 'muted'}`}>{a.active ? 'active' : 'off'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
