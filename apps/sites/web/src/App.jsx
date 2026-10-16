import React, { useEffect, useState, useCallback, useRef } from 'react';

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
  sites: () => req('GET', '/api/sites'),
  createSite: name => req('POST', '/api/sites', { name }),
  site: id => req('GET', `/api/sites/${id}`),
  updateSite: (id, p) => req('PATCH', `/api/sites/${id}`, p),
  deleteSite: id => req('DELETE', `/api/sites/${id}`),
  addPage: (id, title) => req('POST', `/api/sites/${id}/pages`, { title }),
  updatePage: (id, p) => req('PATCH', `/api/pages/${id}`, p),
  deletePage: id => req('DELETE', `/api/pages/${id}`),
};

const BLOCKS = {
  hero: { label: 'Hero', fields: ['heading', 'subheading', 'buttonText', 'buttonUrl', 'image', 'bg'] },
  heading: { label: 'Heading', fields: ['text'] },
  text: { label: 'Text', fields: ['text'] },
  image: { label: 'Image', fields: ['image', 'alt', 'caption'] },
  cta: { label: 'Call to action', fields: ['heading', 'text', 'buttonText', 'buttonUrl'] },
  columns: { label: 'Columns', fields: ['columns'] },
  form: { label: 'Form (SynergyForms)', fields: ['slug'] },
  booking: { label: 'Booking (Bookings page, and a service if you like)', fields: ['owner', 'slug'] },
  embed: { label: 'Embed (iframe)', fields: ['url'] },
  footer: { label: 'Footer', fields: ['text'] },
};
const FIELD_LABEL = {
  heading: 'Heading', subheading: 'Subheading', buttonText: 'Button text', buttonUrl: 'Button URL',
  image: 'Image URL', bg: 'Background color (hex)', text: 'Text', alt: 'Alt text', caption: 'Caption',
  slug: 'Form or service slug', owner: 'Booking page (its web address)', url: 'URL', columns: 'Columns',
};
const MULTILINE = new Set(['text', 'subheading']);

export default function App() {
  const [me, setMe] = useState(null);
  const [sites, setSites] = useState([]);
  const [editing, setEditing] = useState(null); // { site, pages }
  const [error, setError] = useState('');
  const flash = useCallback(e => { setError(String(e.message || e)); setTimeout(() => setError(''), 5000); }, []);

  const refresh = useCallback(() => api.sites().then(setSites).catch(flash), [flash]);
  useEffect(() => { api.me().then(setMe).catch(flash); refresh(); }, []); // eslint-disable-line
  // Deep link from search: /?site=<id>&page=<id> opens that site (and page) in the editor.
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const id = p.get('site');
    if (id) api.site(id).then(d => setEditing({ ...d, startPage: p.get('page') })).catch(flash);
  }, []); // eslint-disable-line

  if (editing) return <Editor initial={editing} onBack={() => { setEditing(null); refresh(); }} flash={flash} />;

  return (
    <div className="wrap-app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">🌐</span> SynergySites</div>
        <span className="hint">{me?.email}</span>
      </header>
      <div className="page-head">
        <h2>Sites</h2>
        <button className="primary" onClick={async () => {
          const name = prompt('Site name?'); if (!name) return;
          try { const s = await api.createSite(name); setEditing(await api.site(s.id)); } catch (e) { flash(e); }
        }}>+ New site</button>
      </div>
      <div className="site-grid">
        {sites.map(s => (
          <div key={s.id} className="site-card">
            <div className="sc-top">
              <b>{s.name}</b>
              <span className={`badge ${s.published ? 'pub' : ''}`}>{s.published ? '🟢 live' : 'draft'}</span>
            </div>
            <div className="sc-url mono">/s/{s.slug} · {s.page_count} page{s.page_count === 1 ? '' : 's'}</div>
            <div className="sc-actions">
              <button className="mini" onClick={async () => { try { setEditing(await api.site(s.id)); } catch (e) { flash(e); } }}>edit</button>
              {s.published && <a className="mini" href={`/s/${s.slug}`} target="_blank" rel="noreferrer">view ↗</a>}
              <button className="mini danger" onClick={async () => { if (confirm(`Delete "${s.name}"?`)) { await api.deleteSite(s.id).catch(flash); refresh(); } }}>delete</button>
            </div>
          </div>
        ))}
        {sites.length === 0 && <p className="hint">No sites yet — create one.</p>}
      </div>
      {error && <div className="toast">{error}</div>}
    </div>
  );
}

function Editor({ initial, onBack, flash }) {
  const [site, setSite] = useState(initial.site);
  const [pages, setPages] = useState(initial.pages);
  const startPage = initial.pages.find(p => initial.startPage && String(p.id) === String(initial.startPage)) || initial.pages[0];
  const [activePage, setActivePage] = useState(startPage?.id);
  const [blocks, setBlocks] = useState(startPage?.blocks || []);
  const [previewKey, setPreviewKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const saveTimer = useRef(null);
  const iframeRef = useRef(null);

  const page = pages.find(p => p.id === activePage);

  const switchPage = useCallback(pid => {
    setActivePage(pid);
    setBlocks(pages.find(p => p.id === pid)?.blocks || []);
  }, [pages]);

  const scheduleSave = useCallback((newBlocks) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.updatePage(activePage, { blocks: newBlocks });
        setPages(ps => ps.map(p => p.id === activePage ? { ...p, blocks: newBlocks } : p));
        setPreviewKey(k => k + 1);
      } catch (e) { flash(e); }
    }, 500);
  }, [activePage, flash]);

  const setBlocksSave = nb => { setBlocks(nb); scheduleSave(nb); };
  const setField = (i, key, val) => setBlocksSave(blocks.map((b, j) => j === i ? { ...b, data: { ...b.data, [key]: val } } : b));
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= blocks.length) return; const nb = [...blocks]; [nb[i], nb[j]] = [nb[j], nb[i]]; setBlocksSave(nb); };
  const addBlock = type => {
    const seed = type === 'columns' ? { columns: [{ heading: 'Column 1', text: '' }, { heading: 'Column 2', text: '' }] } : {};
    setBlocksSave([...blocks, { type, data: seed }]);
    setAddOpen(false);
  };

  return (
    <div className="editor">
      <header className="topbar">
        <div className="tb-left">
          <button className="mini" onClick={onBack}>← Sites</button>
          <b>{site.name}</b>
          <span className={`badge ${site.published ? 'pub' : ''}`}>{site.published ? 'live' : 'draft'}</span>
        </div>
        <div className="tb-right">
          <button className="mini" onClick={async () => {
            const p = await api.updateSite(site.id, { published: !site.published }).catch(flash);
            if (p) setSite(p);
          }}>{site.published ? 'Unpublish' : 'Publish'}</button>
          {site.published && <a className="mini" href={`/s/${site.slug}`} target="_blank" rel="noreferrer">view live ↗</a>}
          <SettingsButton site={site} setSite={setSite} flash={flash} onChanged={() => setPreviewKey(k => k + 1)} />
        </div>
      </header>

      <div className="pagebar">
        {pages.map(p => (
          <button key={p.id} className={`ptab ${p.id === activePage ? 'on' : ''}`} onClick={() => switchPage(p.id)}>
            {p.is_home ? '🏠 ' : ''}{p.title}
          </button>
        ))}
        <button className="ptab add" onClick={async () => {
          const title = prompt('Page title?'); if (!title) return;
          const np = await api.addPage(site.id, title).catch(flash);
          if (np) { setPages([...pages, np]); switchPage(np.id); }
        }}>+ page</button>
      </div>

      <div className="editor-body">
        <div className="blocks-pane">
          {blocks.map((b, i) => (
            <div key={i} className="block-edit">
              <div className="be-head">
                <b>{BLOCKS[b.type]?.label || b.type}</b>
                <div className="be-tools">
                  <button className="mini" onClick={() => move(i, -1)}>↑</button>
                  <button className="mini" onClick={() => move(i, 1)}>↓</button>
                  <button className="mini danger" onClick={() => setBlocksSave(blocks.filter((_, j) => j !== i))}>✕</button>
                </div>
              </div>
              {(BLOCKS[b.type]?.fields || []).map(f => f === 'columns' ? (
                <ColumnsField key={f} value={b.data.columns || []} onChange={cols => setField(i, 'columns', cols)} />
              ) : (
                <label key={f} className="fld">{FIELD_LABEL[f] || f}
                  {MULTILINE.has(f)
                    ? <textarea value={b.data[f] || ''} onChange={e => setField(i, f, e.target.value)} />
                    : <input value={b.data[f] || ''} onChange={e => setField(i, f, e.target.value)}
                        placeholder={f === 'slug' && b.type === 'form' ? 'contact-sales' : b.type === 'booking' ? (f === 'owner' ? 'contoso-clinic' : 'first-assessment (optional)') : f === 'bg' ? '#f6f7f9' : ''} />}
                </label>
              ))}
            </div>
          ))}
          <div className="add-block">
            <button className="primary" onClick={() => setAddOpen(o => !o)}>+ Add block</button>
            {addOpen && (
              <div className="add-menu">
                {Object.entries(BLOCKS).map(([t, def]) => (
                  <button key={t} onClick={() => addBlock(t)}>{def.label}</button>
                ))}
              </div>
            )}
          </div>
          {page && !page.is_home && (
            <button className="mini danger delpage" onClick={async () => {
              if (!confirm(`Delete page "${page.title}"?`)) return;
              await api.deletePage(page.id).catch(flash);
              const rest = pages.filter(p => p.id !== page.id);
              setPages(rest); switchPage(rest[0].id);
            }}>Delete this page</button>
          )}
        </div>
        <div className="preview-pane">
          <div className="preview-label">Live preview</div>
          <iframe key={previewKey} ref={iframeRef} className="preview-frame" src={`/api/pages/${activePage}/preview${DEV_AS ? `?as=${DEV_AS}` : ''}`} title="preview" />
        </div>
      </div>
    </div>
  );
}

function ColumnsField({ value, onChange }) {
  const set = (i, key, val) => onChange(value.map((c, j) => j === i ? { ...c, [key]: val } : c));
  return (
    <div className="cols-field">
      {value.map((c, i) => (
        <div key={i} className="col-edit">
          <input value={c.heading || ''} placeholder="Heading" onChange={e => set(i, 'heading', e.target.value)} />
          <textarea value={c.text || ''} placeholder="Text" onChange={e => set(i, 'text', e.target.value)} />
          <button className="mini danger" onClick={() => onChange(value.filter((_, j) => j !== i))}>remove column</button>
        </div>
      ))}
      {value.length < 4 && <button className="mini" onClick={() => onChange([...value, { heading: '', text: '' }])}>+ column</button>}
    </div>
  );
}

function SettingsButton({ site, setSite, flash, onChanged }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: site.name, description: site.description,
    primary: site.theme?.primary || '#4f46e5', font: site.theme?.font || 'sans',
    livechatKey: site.livechat_key || '',
  });
  const save = async () => {
    try {
      const p = await api.updateSite(site.id, {
        name: f.name, description: f.description,
        theme: { primary: f.primary, font: f.font }, livechatKey: f.livechatKey,
      });
      setSite(p); onChanged(); setOpen(false);
    } catch (e) { flash(e); }
  };
  return (
    <>
      <button className="mini" onClick={() => setOpen(true)}>⚙ settings</button>
      {open && (
        <div className="backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Site settings</h3>
            <label className="fld">Name<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
            <label className="fld">Description (SEO)<input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
            <label className="fld">Primary color<input type="color" value={f.primary} onChange={e => setF({ ...f, primary: e.target.value })} /></label>
            <label className="fld">Font
              <select value={f.font} onChange={e => setF({ ...f, font: e.target.value })}>
                <option value="sans">Sans-serif</option><option value="serif">Serif</option><option value="mono">Mono</option>
              </select>
            </label>
            <label className="fld">LiveChat widget key <span className="hint">(embeds the chat bubble)</span>
              <input value={f.livechatKey} onChange={e => setF({ ...f, livechatKey: e.target.value })} placeholder="wc_..." /></label>
            <div className="modal-actions"><button onClick={() => setOpen(false)}>Cancel</button><button className="primary" onClick={save}>Save</button></div>
          </div>
        </div>
      )}
    </>
  );
}
