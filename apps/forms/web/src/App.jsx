import React, { useEffect, useState, useCallback } from 'react';

const DEV_AS = new URLSearchParams(location.search).get('as');
async function req(method, url, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (DEV_AS) headers['x-dev-user'] = DEV_AS;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const api = {
  me: () => req('GET', '/api/me'),
  forms: () => req('GET', '/api/forms'),
  form: id => req('GET', `/api/forms/${id}`),
  create: f => req('POST', '/api/forms', f),
  update: (id, f) => req('PATCH', `/api/forms/${id}`, f),
  remove: id => req('DELETE', `/api/forms/${id}`),
  submissions: id => req('GET', `/api/forms/${id}/submissions`),
};

const fmt = ts => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const FIELD_TYPES = ['text', 'textarea', 'email', 'select', 'checkbox'];

export default function App() {
  const [me, setMe] = useState(null);
  const [forms, setForms] = useState([]);
  const [editing, setEditing] = useState(null);   // full form object
  const [viewing, setViewing] = useState(null);   // {form, submissions}
  const [error, setError] = useState('');
  const flash = useCallback(e => { setError(String(e.message || e)); setTimeout(() => setError(''), 5000); }, []);

  const refresh = useCallback(() => api.forms().then(setForms).catch(flash), [flash]);
  useEffect(() => {
    api.me().then(setMe).catch(flash); refresh();
    // Deep link from suite search: /?form=<id> opens the builder, &responses=1 its submissions.
    const link = new URLSearchParams(location.search);
    const id = Number(link.get('form'));
    if (!id) return;
    api.form(id).then(async f => {
      if (link.get('responses')) setViewing({ form: f, submissions: await api.submissions(f.id) });
      else setEditing(f);
    }).catch(flash);
  }, []); // eslint-disable-line

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span> SynergyForms</div>
        <span className="hint">{me?.email}</span>
      </header>

      {!editing && !viewing && (
        <main className="main">
          <div className="page-head">
            <h2>Forms</h2>
            <button className="primary" onClick={async () => {
              try {
                const f = await api.create({ title: `Untitled form ${forms.length + 1}`, fields: [{ label: 'Name', type: 'text', required: true }, { label: 'Email', type: 'email', required: true }] });
                setEditing(f);
              } catch (e) { flash(e); }
            }}>+ New form</button>
          </div>
          <table className="table">
            <thead><tr><th>Title</th><th>Public URL</th><th>Status</th><th>Submissions</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              {forms.map(f => (
                <tr key={f.id}>
                  <td onClick={async () => setEditing(await api.form(f.id))} className="link">{f.title}</td>
                  <td className="mono">/f/{f.slug}
                    {f.published && <button className="mini" onClick={() => navigator.clipboard.writeText(`${location.origin}/f/${f.slug}`)}>copy</button>}
                  </td>
                  <td>{f.published ? '🟢 live' : '⚪ draft'}</td>
                  <td onClick={async () => setViewing({ form: f, submissions: await api.submissions(f.id) })} className="link">{f.submission_count}</td>
                  <td>{fmt(f.updated_at)}</td>
                  <td><button className="mini" onClick={async () => { if (confirm(`Delete "${f.title}" and its submissions?`)) { await api.remove(f.id).catch(flash); refresh(); } }}>delete</button></td>
                </tr>
              ))}
              {forms.length === 0 && <tr><td colSpan="6" className="empty-row">No forms yet.</td></tr>}
            </tbody>
          </table>
        </main>
      )}

      {editing && (
        <Builder form={editing} onBack={() => { setEditing(null); refresh(); }} flash={flash} />
      )}

      {viewing && (
        <main className="main">
          <div className="page-head">
            <div><button className="mini" onClick={() => setViewing(null)}>← back</button> <h2 className="inline">{viewing.form.title} — submissions</h2></div>
            <a className="mini btn-link" href={`/api/forms/${viewing.form.id}/export`}>Export CSV</a>
          </div>
          <SubmissionsTable formId={viewing.form.id} submissions={viewing.submissions} />
        </main>
      )}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}

function SubmissionsTable({ formId, submissions }) {
  const [form, setForm] = useState(null);
  useEffect(() => { api.form(formId).then(setForm).catch(() => {}); }, [formId]);
  if (!form) return <p className="hint">Loading…</p>;
  return (
    <div className="scroll-x">
      <table className="table">
        <thead><tr><th>When</th>{form.fields.map(f => <th key={f.id}>{f.label}</th>)}</tr></thead>
        <tbody>
          {submissions.map(s => (
            <tr key={s.id}>
              <td>{fmt(s.submitted_at)}</td>
              {form.fields.map(f => <td key={f.id}>{String(s.data[f.id] ?? '')}</td>)}
            </tr>
          ))}
          {submissions.length === 0 && <tr><td colSpan={form.fields.length + 1} className="empty-row">No submissions yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Builder({ form, onBack, flash }) {
  const [f, setF] = useState({ ...form, fields: form.fields.map(x => ({ ...x })) });
  const [saved, setSaved] = useState(true);
  const set = patch => { setF(prev => ({ ...prev, ...patch })); setSaved(false); };
  const setField = (i, patch) => { setF(prev => ({ ...prev, fields: prev.fields.map((x, j) => j === i ? { ...x, ...patch } : x) })); setSaved(false); };
  const move = (i, dir) => {
    setF(prev => {
      const fields = [...prev.fields];
      const j = i + dir;
      if (j < 0 || j >= fields.length) return prev;
      [fields[i], fields[j]] = [fields[j], fields[i]];
      return { ...prev, fields };
    });
    setSaved(false);
  };

  const save = async (extra = {}) => {
    try {
      await api.update(f.id, { title: f.title, description: f.description, fields: f.fields, ...extra });
      setSaved(true);
      if (extra.published != null) setF(prev => ({ ...prev, published: extra.published }));
    } catch (e) { flash(e); }
  };

  return (
    <main className="main">
      <div className="page-head">
        <div><button className="mini" onClick={onBack}>← back</button> <h2 className="inline">Builder</h2></div>
        <div>
          <span className="hint">{saved ? 'saved' : 'unsaved changes'}</span>
          <button onClick={() => save()}>Save</button>
          {f.published
            ? <button onClick={() => save({ published: false })}>Unpublish</button>
            : <button className="primary" onClick={() => save({ published: true })}>Publish</button>}
          {f.published && <a className="mini btn-link" href={`/f/${f.slug}`} target="_blank" rel="noreferrer">view live ↗</a>}
        </div>
      </div>

      <div className="builder">
        <label>Title <input value={f.title} onChange={e => set({ title: e.target.value })} /></label>
        <label>Description <input value={f.description} onChange={e => set({ description: e.target.value })} /></label>

        {f.fields.map((fl, i) => (
          <div key={i} className="field-row">
            <input className="grow" value={fl.label} onChange={e => setField(i, { label: e.target.value })} />
            <select value={fl.type} onChange={e => setField(i, { type: e.target.value })}>
              {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="row"><input type="checkbox" checked={fl.required} onChange={e => setField(i, { required: e.target.checked })} /> req</label>
            <button className="mini" onClick={() => move(i, -1)}>↑</button>
            <button className="mini" onClick={() => move(i, 1)}>↓</button>
            <button className="mini" onClick={() => { setF(prev => ({ ...prev, fields: prev.fields.filter((_, j) => j !== i) })); setSaved(false); }}>✕</button>
            {fl.type === 'select' && (
              <input className="full" placeholder="Options, comma separated"
                value={(fl.options || []).join(', ')}
                onChange={e => setField(i, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
            )}
          </div>
        ))}
        <button className="mini" onClick={() => { setF(prev => ({ ...prev, fields: [...prev.fields, { label: '', type: 'text', required: false, options: [] }] })); setSaved(false); }}>+ add field</button>
      </div>
    </main>
  );
}
