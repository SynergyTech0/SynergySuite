'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';

interface Contact {
  id: string; email: string; first_name: string | null; last_name: string | null;
  company: string | null; status: string;
}

export default function AudienceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [csv, setCsv] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [single, setSingle] = useState({ email: '', first_name: '', last_name: '', company: '' });

  const load = () => fetch(`/api/contacts?audience=${id}`).then((r) => r.json())
    .then((d) => Array.isArray(d) ? setContacts(d) : setErr(d.error)).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, [id]);

  const addOne = async () => {
    if (!single.email) return;
    setBusy(true); setErr(''); setMsg('');
    const r = await fetch('/api/contacts', { method: 'POST', body: JSON.stringify({ audience_id: id, ...single }) });
    const d = await r.json(); setBusy(false);
    if (d.error) setErr(d.error);
    else { setSingle({ email: '', first_name: '', last_name: '', company: '' }); setMsg(d.created ? 'Contact added.' : 'Contact updated.'); load(); }
  };

  const importCsv = async () => {
    if (!csv.trim()) return;
    setBusy(true); setErr(''); setMsg('');
    const r = await fetch('/api/contacts/import', { method: 'POST', body: JSON.stringify({ audience_id: id, csv }) });
    const d = await r.json(); setBusy(false);
    if (d.error) setErr(d.error);
    else { setMsg(`Imported: ${d.created} new, ${d.updated} updated, ${d.skipped} skipped.`); setCsv(''); load(); }
  };

  const unsub = async (cid: string) => {
    await fetch('/api/contacts/status', { method: 'POST', body: JSON.stringify({ id: cid, status: 'unsubscribed' }) });
    load();
  };

  return (
    <>
      <p className="sub"><Link href="/audiences">← Audiences</Link></p>
      <h1>Contacts</h1>
      {msg && <div className="notice ok">{msg}</div>}
      {err && <div className="notice err">{err}</div>}

      <div className="split">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Add a contact</h2>
          <input placeholder="email@example.com" value={single.email} onChange={(e) => setSingle({ ...single, email: e.target.value })} />
          <div className="row">
            <div style={{ flex: 1 }}><label>First name</label><input value={single.first_name} onChange={(e) => setSingle({ ...single, first_name: e.target.value })} /></div>
            <div style={{ flex: 1 }}><label>Last name</label><input value={single.last_name} onChange={(e) => setSingle({ ...single, last_name: e.target.value })} /></div>
          </div>
          <label>Company</label>
          <input value={single.company} onChange={(e) => setSingle({ ...single, company: e.target.value })} />
          <div style={{ marginTop: 12 }}><button onClick={addOne} disabled={busy}>Add contact</button></div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Import CSV</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            First row = headers. An <small className="code">email</small> column is required.
            <small className="code">first_name</small>, <small className="code">last_name</small>,
            <small className="code">company</small> are recognized; any other columns become merge fields.
          </p>
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)}
            placeholder={'email,first_name,company\njane@acme.com,Jane,Acme'} style={{ minHeight: 150, fontFamily: 'ui-monospace, monospace' }} />
          <div style={{ marginTop: 12 }}><button onClick={importCsv} disabled={busy}>Import</button></div>
        </div>
      </div>

      <div className="card">
        <div className="toolbar"><h2 style={{ margin: 0 }}>{contacts.length} contacts</h2></div>
        {contacts.length === 0 ? <p className="muted">No contacts yet.</p> : (
          <table>
            <thead><tr><th>Email</th><th>Name</th><th>Company</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>{c.email}</td>
                  <td>{[c.first_name, c.last_name].filter(Boolean).join(' ') || <span className="muted">—</span>}</td>
                  <td>{c.company || <span className="muted">—</span>}</td>
                  <td><span className={`chip ${c.status === 'subscribed' ? 'ok' : 'muted'}`}>{c.status}</span></td>
                  <td>{c.status === 'subscribed' && <button className="ghost" onClick={() => unsub(c.id)}>Unsubscribe</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
