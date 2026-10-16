'use client';
import { use, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState('');

  const load = useCallback(() => fetch(`/api/campaigns/${id}`).then((r) => r.json()).then((d) => {
    if (d.error) setErr(d.error); else setData(d);
  }), [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (payload: any, okMsg: (d: any) => string) => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await fetch(`/api/campaigns/${id}/send`, { method: 'POST', body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.error) setErr(d.error); else setMsg(okMsg(d));
    } catch (e) { setErr(String(e)); }
    setBusy(false); load();
  };

  if (err && !data) return <div className="notice err">{err}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  const { campaign: c, stats, events } = data;
  const rate = (n: number) => stats.sends ? `${Math.round((n / stats.sends) * 100)}%` : '—';
  const canSend = c.status === 'draft' || c.status === 'scheduled' || c.status === 'failed';

  return (
    <>
      <p className="sub"><Link href="/campaigns">← Campaigns</Link></p>
      <div className="toolbar">
        <div><h1 style={{ margin: 0 }}>{c.name}</h1>
          <span className={`chip ${c.status === 'sent' ? 'ok' : c.status === 'failed' ? 'danger' : c.status === 'scheduled' ? 'warn' : 'muted'}`}>{c.status}</span>
          <span className="muted" style={{ marginLeft: 8 }}>{c.subject}</span></div>
      </div>
      {msg && <div className="notice ok">{msg}</div>}
      {err && <div className="notice err">{err}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Send</h2>
        <div className="row">
          <button className="ghost" disabled={busy} onClick={() => act({ dryRun: true },
            (d) => `Dry run OK — would send to ${d.total} contacts (nothing was sent).`)}>Dry run</button>
          <button disabled={busy || !canSend} onClick={() => { if (confirm('Send this campaign now?')) act({},
            (d) => `Sent ${d.sent} / ${d.total}. ${d.failed ? d.failed + ' failed.' : ''}`); }}>Send now</button>
          <span className="muted">or schedule:</span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ width: 220 }} />
          <button className="ghost" disabled={busy || !when} onClick={() => act({ scheduleMs: new Date(when).getTime() },
            (d) => `Scheduled for ${new Date(d.at).toLocaleString()}.`)}>Schedule</button>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>Dry run first to confirm the recipient count. Scheduled sends fire on the next scheduler tick (<small className="code">/api/cron</small>).</p>
      </div>

      <h2>Performance</h2>
      <div className="grid">
        <div className="card stat"><div className="n">{stats.sends}</div><div className="l">Sent</div></div>
        <div className="card stat"><div className="n">{stats.uniqueOpens}</div><div className="l">Opens ({rate(stats.uniqueOpens)})</div></div>
        <div className="card stat"><div className="n">{stats.uniqueClicks}</div><div className="l">Clicks ({rate(stats.uniqueClicks)})</div></div>
        <div className="card stat"><div className="n">{stats.unsubs}</div><div className="l">Unsubscribes</div></div>
      </div>

      <h2>Recent activity</h2>
      <div className="card">
        {events.length === 0 ? <p className="muted">No activity yet.</p> : (
          <table>
            <thead><tr><th>Event</th><th>Contact</th><th>Detail</th><th>Time</th></tr></thead>
            <tbody>
              {events.map((e: any, i: number) => (
                <tr key={i}>
                  <td><span className={`chip ${e.kind === 'open' ? 'ok' : e.kind === 'click' ? '' : e.kind === 'unsub' ? 'danger' : 'muted'}`}>{e.kind}</span></td>
                  <td>{e.email}</td>
                  <td className="muted" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.url ?? '—'}</td>
                  <td className="muted">{e.ts_ms ? new Date(Number(e.ts_ms)).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
