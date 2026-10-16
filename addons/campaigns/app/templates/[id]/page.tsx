'use client';
import { use, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

type Block = { type: string; [k: string]: any };

const BLOCK_TYPES = ['heading', 'text', 'button', 'image', 'divider'] as const;
const blank = (type: string): Block => {
  switch (type) {
    case 'heading': return { type, text: 'Heading' };
    case 'text': return { type, text: 'Write something…' };
    case 'button': return { type, text: 'Click here', url: 'https://', color: '#0b5cff' };
    case 'image': return { type, url: 'https://', alt: '' };
    default: return { type: 'divider' };
  }
};

export default function TemplateEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [html, setHtml] = useState('');
  const [msg, setMsg] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/templates/${id}`).then((r) => r.json()).then((t) => {
      setName(t.name ?? ''); setSubject(t.subject ?? '');
      setBlocks(Array.isArray(t.blocks) ? t.blocks : []); setHtml(t.html ?? ''); setLoaded(true);
    });
  }, [id]);

  const save = useCallback(async () => {
    const r = await fetch(`/api/templates/${id}`, {
      method: 'PUT', body: JSON.stringify({ name, subject, blocks }),
    });
    const d = await r.json();
    if (d.html) { setHtml(d.html); setMsg('Saved.'); setTimeout(() => setMsg(''), 1500); }
  }, [id, name, subject, blocks]);

  const update = (i: number, patch: Partial<Block>) =>
    setBlocks((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) => setBlocks((b) => {
    const j = i + dir; if (j < 0 || j >= b.length) return b;
    const c = [...b]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });
  const remove = (i: number) => setBlocks((b) => b.filter((_, j) => j !== i));
  const add = (type: string) => setBlocks((b) => [...b, blank(type)]);

  if (!loaded) return <p className="muted">Loading…</p>;

  const previewDoc = html
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|\s*default:\s*([^}]*?)\s*)?\}\}/g, (_m, k, d) =>
      ({ first_name: 'Jane', last_name: 'Doe', company: 'Acme Co' } as any)[k] ?? d ?? `[${k}]`);

  return (
    <>
      <p className="sub"><Link href="/templates">← Templates</Link></p>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Edit template</h1>
        <div className="row">{msg && <span className="chip ok">{msg}</span>}<button onClick={save}>Save</button></div>
      </div>

      <div className="split">
        <div>
          <div className="card">
            <label>Template name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <label>Subject line</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            <p className="muted" style={{ fontSize: 12 }}>Merge tags: <small className="code">{'{{ first_name|default: there }}'}</small>, <small className="code">{'{{ company }}'}</small>, or any CSV column.</p>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Content blocks</h2>
            {blocks.map((b, i) => (
              <div className="blk" key={i}>
                <div className="row">
                  <strong style={{ textTransform: 'capitalize' }}>{b.type}</strong>
                  <div className="row">
                    <button className="ghost" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                    <button className="ghost" onClick={() => move(i, 1)} disabled={i === blocks.length - 1}>↓</button>
                    <button className="danger" onClick={() => remove(i)}>✕</button>
                  </div>
                </div>
                {(b.type === 'heading' || b.type === 'text') && (
                  <textarea value={b.text ?? ''} onChange={(e) => update(i, { text: e.target.value })} />
                )}
                {b.type === 'button' && (<>
                  <label>Label</label><input value={b.text ?? ''} onChange={(e) => update(i, { text: e.target.value })} />
                  <label>URL</label><input value={b.url ?? ''} onChange={(e) => update(i, { url: e.target.value })} />
                  <label>Color</label><input value={b.color ?? '#0b5cff'} onChange={(e) => update(i, { color: e.target.value })} />
                </>)}
                {b.type === 'image' && (<>
                  <label>Image URL</label><input value={b.url ?? ''} onChange={(e) => update(i, { url: e.target.value })} />
                  <label>Alt text</label><input value={b.alt ?? ''} onChange={(e) => update(i, { alt: e.target.value })} />
                </>)}
              </div>
            ))}
            <div className="row" style={{ marginTop: 10 }}>
              {BLOCK_TYPES.map((t) => (
                <button key={t} className="ghost" onClick={() => add(t)}>+ {t}</button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              <strong>Preview</strong> <span className="muted" style={{ fontSize: 12 }}>(merge tags filled with sample data — Save to refresh)</span>
            </div>
            <div className="preview"><iframe title="preview" srcDoc={previewDoc} /></div>
          </div>
        </div>
      </div>
    </>
  );
}
