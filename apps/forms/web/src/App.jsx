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
  share: (id, shares) => req('PUT', `/api/forms/${id}/shares`, { shares }),
};

const ROLE_LABEL = { owner: 'Owner', edit: 'Can edit', view: 'Can view' };

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
            <thead><tr><th>Title</th><th>Public URL</th><th>Status</th><th>Submissions</th><th>Owner</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              {forms.map(f => (
                <tr key={f.id}>
                  <td onClick={async () => setEditing(await api.form(f.id))} className="link">{f.title}</td>
                  <td className="mono">/f/{f.slug}
                    {f.published && <button className="mini" onClick={() => navigator.clipboard.writeText(`${location.origin}/f/${f.slug}`)}>copy</button>}
                  </td>
                  <td>{f.published ? '🟢 live' : '⚪ draft'}</td>
                  <td onClick={async () => setViewing({ form: f, submissions: await api.submissions(f.id) })} className="link">{f.submission_count}</td>
                  <td>{f.role === 'owner' ? 'You' : <>{f.owner || '—'} <span className="hint">({ROLE_LABEL[f.role]})</span></>}</td>
                  <td>{fmt(f.updated_at)}</td>
                  <td>{f.role === 'owner' && <button className="mini" onClick={async () => { if (confirm(`Delete "${f.title}" and its submissions?`)) { await api.remove(f.id).catch(flash); refresh(); } }}>delete</button>}</td>
                </tr>
              ))}
              {forms.length === 0 && <tr><td colSpan="7" className="empty-row">No forms yet. Forms shared with you show up here too.</td></tr>}
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
  const [sharing, setSharing] = useState(false);
  const readOnly = form.role === 'view';
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
          {readOnly ? <span className="hint">view only, shared by {form.created_by}</span> : <>
            <span className="hint">{saved ? 'saved' : 'unsaved changes'}</span>
            <button onClick={() => save()}>Save</button>
            {f.published
              ? <button onClick={() => save({ published: false })}>Unpublish</button>
              : <button className="primary" onClick={() => save({ published: true })}>Publish</button>}
          </>}
          {form.role === 'owner' && <button onClick={() => setSharing(true)}>Share</button>}
          {f.published && <a className="mini btn-link" href={`/f/${f.slug}`} target="_blank" rel="noreferrer">view live ↗</a>}
        </div>
      </div>
      {sharing && <ShareDialog form={form} onClose={() => setSharing(false)} flash={flash} />}

      <fieldset className="builder" disabled={readOnly}>
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
      </fieldset>
    </main>
  );
}

// Who else can open the form: people by email, or everyone in the organization.
function ShareDialog({ form, onClose, flash }) {
  const [shares, setShares] = useState(form.shares || []);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('view');
  const everyone = shares.find(s => s.principal === '*');
  const people = shares.filter(s => s.principal !== '*');
  const save = async next => {
    try { const saved = await api.share(form.id, next); setShares(saved); form.shares = saved; } catch (e) { flash(e); }
  };
  const setEveryone = r => save([...people, ...(r ? [{ principal: '*', role: r }] : [])]);
  return (
    <div className="share-panel">
      <div className="page-head"><h3>Share "{form.title}"</h3><button className="mini" onClick={onClose}>close</button></div>
      <p className="hint">Only you and the people below can find this form, in the app and in suite search. Editors can change it and read its responses; viewers can read them.</p>
      <label>Everyone in your organization{' '}
        <select value={everyone?.role || ''} onChange={e => setEveryone(e.target.value)}>
          <option value="">No access</option><option value="view">Can view</option><option value="edit">Can edit</option>
        </select>
      </label>
      <table className="table">
        <tbody>
          {people.map(s => (
            <tr key={s.principal}>
              <td>{s.principal}</td>
              <td><select value={s.role} onChange={e => save(shares.map(x => x.principal === s.principal ? { ...x, role: e.target.value } : x))}>
                <option value="view">Can view</option><option value="edit">Can edit</option>
              </select></td>
              <td><button className="mini" onClick={() => save(shares.filter(x => x.principal !== s.principal))}>remove</button></td>
            </tr>
          ))}
          {people.length === 0 && <tr><td colSpan="3" className="empty-row">Not shared with anyone yet.</td></tr>}
        </tbody>
      </table>
      <form className="field-row" onSubmit={e => { e.preventDefault(); if (email.trim()) { save([...shares.filter(x => x.principal !== email.trim().toLowerCase()), { principal: email.trim(), role }]); setEmail(''); } }}>
        <input className="grow" type="email" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} />
        <select value={role} onChange={e => setRole(e.target.value)}><option value="view">Can view</option><option value="edit">Can edit</option></select>
        <button className="primary" type="submit">Add</button>
      </form>
    </div>
  );
}
