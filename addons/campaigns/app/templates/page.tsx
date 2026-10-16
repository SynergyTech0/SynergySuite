'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Template { id: string; name: string; subject: string | null; }

export default function TemplatesPage() {
  const router = useRouter();
  const [items, setItems] = useState<Template[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => fetch('/api/templates').then((r) => r.json()).then(setItems);
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const starter = [
      { type: 'heading', text: 'Hi {{ first_name|default: there }},' },
      { type: 'text', text: "Here's what's new at {{ company|default: our company }}." },
      { type: 'button', text: 'Learn more', url: 'https://example.com', color: '#0b5cff' },
    ];
    const r = await fetch('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name, subject: 'A quick update for {{ first_name|default: you }}', blocks: starter }),
    });
    const d = await r.json(); setBusy(false);
    if (d.id) router.push(`/templates/${d.id}`);
  };

  return (
    <>
      <h1>Templates</h1>
      <p className="sub">Design reusable emails with content blocks. Use <small className="code">{'{{ first_name }}'}</small> style merge tags anywhere.</p>
      <div className="card">
        <div className="row">
          <input placeholder="New template name" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()} style={{ maxWidth: 340 }} />
          <button onClick={create} disabled={busy}>Create &amp; edit</button>
        </div>
      </div>
      <div className="card">
        {items.length === 0 ? <p className="muted">No templates yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Subject</th><th></th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="muted">{t.subject}</td>
                  <td><Link href={`/templates/${t.id}`}>Edit →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
