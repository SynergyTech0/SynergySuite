'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Audience { id: string; name: string; count?: number; }

export default function AudiencesPage() {
  const [items, setItems] = useState<Audience[]>([]);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => fetch('/api/audiences').then((r) => r.json())
    .then((d) => Array.isArray(d) ? setItems(d) : setErr(d.error ?? 'load failed'))
    .catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr('');
    const r = await fetch('/api/audiences', { method: 'POST', body: JSON.stringify({ name }) });
    const d = await r.json();
    setBusy(false);
    if (d.error) setErr(d.error); else { setName(''); load(); }
  };

  return (
    <>
      <h1>Audiences</h1>
      <p className="sub">Lists of contacts. Import a CSV into an audience, then target it with a campaign.</p>
      {err && <div className="notice err">{err}</div>}

      <div className="card">
        <div className="row">
          <input placeholder="New audience name (e.g. Newsletter)" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} style={{ maxWidth: 340 }} />
          <button onClick={create} disabled={busy}>Create audience</button>
        </div>
      </div>

      <div className="card">
        {items.length === 0 ? <p className="muted">No audiences yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Subscribed</th><th></th></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.count ?? 0}</td>
                  <td><Link href={`/audiences/${a.id}`}>Manage contacts →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
