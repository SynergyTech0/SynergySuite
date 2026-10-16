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
  clients: () => req('GET', '/api/clients'),
  create: c => req('POST', '/api/clients', c),
  update: (id, c) => req('PATCH', `/api/clients/${id}`, c),
  rotate: id => req('POST', `/api/clients/${id}/rotate`),
  preview: id => req('GET', `/api/clients/${id}/preview`),
};

const usd = c => '$' + (Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

export default function App() {
  const [me, setMe] = useState(null);
  const [denied, setDenied] = useState(false);
  const [clients, setClients] = useState([]);
  const [editor, setEditor] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const flash = useCallback(e => {
    if (String(e.message).includes('authorized')) { setDenied(true); return; }
    setError(String(e.message || e)); setTimeout(() => setError(''), 5000);
  }, []);

  const refresh = useCallback(() => api.clients().then(setClients).catch(flash), [flash]);
  useEffect(() => { api.me().then(setMe).catch(flash); refresh(); }, []); // eslint-disable-line

  const portalUrl = c => `${location.origin}/c/${c.token}`;

  if (denied) return <div className="denied"><h2>🚪 SynergyPortal</h2><p>Your account isn't authorized for this app.</p></div>;

  return (
    <div className="wrap">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">🚪</span> SynergyPortal</div>
        <span className="hint">{me?.email}</span>
      </header>

      <div className="page-head">
        <div>
          <h2>Client portals</h2>
          <p className="hint">Each client gets a private link showing their invoices (with Pay buttons) and support tickets — no login required.</p>
        </div>
        <button className="primary" onClick={() => setEditor({})}>+ New client</button>
      </div>

      <table className="table">
        <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Portal link</th><th>Last seen</th><th></th></tr></thead>
        <tbody>
          {clients.map(c => (
            <tr key={c.id} className={c.active ? '' : 'inactive'}>
              <td>{c.name}</td>
              <td>{c.company || '—'}</td>
              <td>{c.email}</td>
              <td>
                <button className="mini" onClick={() => { navigator.clipboard.writeText(portalUrl(c)); flash({ message: 'link copied' }); }}>copy link</button>
                <a className="mini" href={portalUrl(c)} target="_blank" rel="noreferrer">open ↗</a>
              </td>
              <td>{c.last_seen_at ? new Date(c.last_seen_at).toLocaleDateString() : 'never'}</td>
              <td className="right">
                <button className="mini" onClick={async () => { try { setPreview(await api.preview(c.id)); } catch (e) { flash(e); } }}>preview</button>
                <button className="mini" onClick={() => setEditor(c)}>edit</button>
                <button className="mini" onClick={async () => { if (confirm('Rotate the link? The old URL stops working immediately.')) { await api.rotate(c.id).catch(flash); refresh(); } }}>rotate</button>
              </td>
            </tr>
          ))}
          {clients.length === 0 && <tr><td colSpan="6" className="empty-row">No clients yet — add one to generate a portal link.</td></tr>}
        </tbody>
      </table>

      {editor && (
        <Editor client={editor.id ? editor : null} onClose={() => setEditor(null)}
          onSave={async payload => {
            try { editor.id ? await api.update(editor.id, payload) : await api.create(payload); setEditor(null); refresh(); }
            catch (e) { flash(e); }
          }} />
      )}

      {preview && <Preview data={preview} onClose={() => setPreview(null)} />}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}

function Editor({ client, onClose, onSave }) {
  const [f, setF] = useState({
    name: client?.name || '', email: client?.email || '', company: client?.company || '',
    welcome: client?.welcome || '', active: client ? client.active : true,
  });
  const set = p => setF(prev => ({ ...prev, ...p }));
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{client ? 'Edit client' : 'New client'}</h3>
        <label>Name <input autoFocus value={f.name} onChange={e => set({ name: e.target.value })} /></label>
        <label>Email <span className="hint">(must match their invoice + ticket email)</span>
          <input value={f.email} onChange={e => set({ email: e.target.value })} /></label>
        <label>Company <input value={f.company} onChange={e => set({ company: e.target.value })} /></label>
        <label>Welcome message <textarea value={f.welcome} onChange={e => set({ welcome: e.target.value })} /></label>
        {client && <label className="row"><input type="checkbox" checked={f.active} onChange={e => set({ active: e.target.checked })} /> active</label>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!f.name.trim() || !f.email.includes('@')} onClick={() => onSave(f)}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Preview({ data, onClose }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal wide" onClick={e => e.stopPropagation()}>
        <h3>Preview — {data.client.company || data.client.name}</h3>
        <div className="prev-summary">
          <span><b>{usd(data.outstanding)}</b> outstanding</span>
          <span>{data.invoices.length} invoices</span>
          <span>{data.tickets.length} tickets</span>
        </div>
        <h4>Invoices</h4>
        {data.invoices.length ? data.invoices.map(i => (
          <div key={i.number} className="prev-row"><span className="mono">{i.number}</span> <span className={`b ${i.status}`}>{i.status}</span> <span className="mono">{usd(i.total_cents)}</span></div>
        )) : <p className="hint">None.</p>}
        <h4>Tickets</h4>
        {data.tickets.length ? data.tickets.map(t => (
          <div key={t.number} className="prev-row"><span className="mono">{t.number}</span> {t.subject} <span className={`b ${t.status}`}>{t.status}</span></div>
        )) : <p className="hint">None.</p>}
        <div className="modal-actions"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
