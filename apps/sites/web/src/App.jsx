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
  groups: () => req('GET', '/api/groups'),
  createSite: body => req('POST', '/api/sites', body),
  members: id => req('GET', `/api/sites/${id}/members`),
  setMember: (id, principal, role) => req('PUT', `/api/sites/${id}/members`, { principal, role }),
  removeMember: (id, principal) => req('DELETE', `/api/sites/${id}/members?principal=${encodeURIComponent(principal)}`),
  library: (id, folder) => req('GET', `/api/sites/${id}/library${folder ? `?folder=${folder}` : ''}`),
  makeLibrary: id => req('POST', `/api/sites/${id}/library`),
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
  const [open, setOpen] = useState(null); // { site, pages, role, library, startPage, edit }
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const flash = useCallback(e => { setError(String(e.message || e)); setTimeout(() => setError(''), 5000); }, []);

  const refresh = useCallback(() => api.sites().then(setSites).catch(flash), [flash]);
  useEffect(() => { api.me().then(setMe).catch(flash); refresh(); }, []); // eslint-disable-line
  // Deep link from search: /?site=<id>&page=<id> opens that site (and page) in the editor.
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const id = p.get('site');
    if (id) api.site(id).then(d => setOpen({ ...d, startPage: p.get('page') })).catch(flash);
  }, []); // eslint-disable-line
  const openSite = async (id, edit = false) => { try { setOpen({ ...(await api.site(id)), edit }); } catch (e) { flash(e); } };
  const home = () => { setOpen(null); refresh(); };

  if (open?.edit) return <Editor initial={open} onBack={() => openSite(open.site.id)} flash={flash} />;
  if (open) return <SiteView initial={open} me={me} onBack={home} onEdit={startPage => setOpen({ ...open, startPage, edit: true })} flash={flash} />;

  return (
    <div className="wrap-app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">🌐</span> SynergySites</div>
        <span className="hint">{me?.email}</span>
      </header>
      <div className="page-head">
        <h2>Sites</h2>
        <button className="primary" onClick={() => setCreating(true)}>+ New site</button>
      </div>
      <div className="site-grid">
        {sites.map(s => (
          <div key={s.id} className="site-card">
            <div className="sc-top">
              <b className="sc-name" onClick={() => openSite(s.id)}>{s.name}</b>
              <SiteBadge site={s} />
            </div>
            <div className="sc-url mono">
              {s.private ? 'Private team site' : `/s/${s.slug}`} · {s.page_count} page{s.page_count === 1 ? '' : 's'} · {ROLE_LABEL[s.role]}
            </div>
            <div className="sc-actions">
              <button className="mini" onClick={() => openSite(s.id)}>open</button>
              {s.role !== 'visitor' && <button className="mini" onClick={() => openSite(s.id, true)}>edit</button>}
              {s.published && !s.private && <a className="mini" href={`/s/${s.slug}`} target="_blank" rel="noreferrer">view ↗</a>}
              {s.role === 'owner' && <button className="mini danger" onClick={async () => { if (confirm(`Delete "${s.name}"?`)) { await api.deleteSite(s.id).catch(flash); refresh(); } }}>delete</button>}
            </div>
          </div>
        ))}
        {sites.length === 0 && <p className="hint">No sites yet — create one.</p>}
      </div>
      {creating && <NewSiteDialog onClose={() => setCreating(false)} flash={flash}
        onCreated={s => { setCreating(false); openSite(s.id); }} />}
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
  const isOwner = initial.role === 'owner';

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
          <button className="mini" onClick={onBack}>← Done editing</button>
          <b>{site.name}</b>
          <SiteBadge site={site} />
        </div>
        <div className="tb-right">
          {isOwner && !site.private && <button className="mini" onClick={async () => {
            const p = await api.updateSite(site.id, { published: !site.published }).catch(flash);
            if (p) setSite(p);
          }}>{site.published ? 'Unpublish' : 'Publish'}</button>}
          {site.published && !site.private && <a className="mini" href={`/s/${site.slug}`} target="_blank" rel="noreferrer">view live ↗</a>}
          {isOwner && <SettingsButton site={site} setSite={setSite} flash={flash} onChanged={() => setPreviewKey(k => k + 1)} />}
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
    livechatKey: site.livechat_key || '', private: !!site.private,
  });
  const save = async () => {
    try {
      const p = await api.updateSite(site.id, {
        name: f.name, description: f.description,
        theme: { primary: f.primary, font: f.font }, livechatKey: f.livechatKey, private: f.private,
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
            <label className="fld">Who can see it
              <select value={f.private ? 'private' : 'org'} onChange={e => setF({ ...f, private: e.target.value === 'private' })}>
                <option value="private">Private: only the site's owners, members and visitors</option>
                <option value="org">Everyone in the organization (and the web, once published)</option>
              </select>
            </label>
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

const ROLE_LABEL = { owner: 'Owner', member: 'Member', visitor: 'Visitor' };

function SiteBadge({ site }) {
  if (site.private) return <span className="badge team">🔒 private</span>;
  return <span className={`badge ${site.published ? 'pub' : ''}`}>{site.published ? '🟢 live' : 'draft'}</span>;
}

// A team site (private, for a group or for the people you add) or a communication site
// (everyone in the organization can read it, and it can be published to the web).
function NewSiteDialog({ onClose, onCreated, flash }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('team');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState([]);
  useEffect(() => { api.groups().then(setGroups).catch(() => setGroups([])); }, []);
  const mine = groups.filter(g => g.role === 'owner' && !g.siteId);
  const create = async () => {
    try {
      const body = { name, private: kind === 'team' };
      if (kind === 'team' && groupId) body.groupId = groupId;
      onCreated(await api.createSite(body));
    } catch (e) { flash(e); }
  };
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>New site</h3>
        <div className="choice">
          <label className={kind === 'team' ? 'on' : ''}>
            <input type="radio" checked={kind === 'team'} onChange={() => setKind('team')} />
            <b>Team site</b><span className="hint">Private. Pages and documents for a team or project.</span>
          </label>
          <label className={kind === 'comm' ? 'on' : ''}>
            <input type="radio" checked={kind === 'comm'} onChange={() => { setKind('comm'); setGroupId(''); }} />
            <b>Communication site</b><span className="hint">Everyone in the organization can read it, and you can publish it to the web.</span>
          </label>
        </div>
        {kind === 'team' && mine.length > 0 && (
          <label className="fld">For a group
            <select value={groupId} onChange={e => {
              setGroupId(e.target.value);
              const g = mine.find(x => x.id === e.target.value);
              if (g && !name) setName(g.name);
            }}>
              <option value="">No group: I'll add people myself</option>
              {mine.map(g => <option key={g.id} value={g.id}>{g.name}{g.kind ? ` (${g.kind.replace('_', ' ')})` : ''}</option>)}
            </select>
          </label>
        )}
        {kind === 'team' && groupId && <p className="hint">The group's owners own the site and its members are site members, as the group changes.</p>}
        <label className="fld">Name<input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && name && create()} /></label>
        <div className="modal-actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!name.trim()} onClick={create}>Create</button></div>
      </div>
    </div>
  );
}

// A site as its people see it: its pages, its document library and who has access.
function SiteView({ initial, me, onBack, onEdit, flash }) {
  const { site, pages, role } = initial;
  const startPage = pages.find(p => initial.startPage && String(p.id) === String(initial.startPage)) || pages[0];
  const [pageId, setPageId] = useState(startPage?.id);
  const [tab, setTab] = useState('pages');
  const canEdit = role === 'owner' || role === 'member';
  return (
    <div className="editor">
      <header className="topbar">
        <div className="tb-left">
          <button className="mini" onClick={onBack}>← Sites</button>
          <b>{site.name}</b>
          <SiteBadge site={site} />
          <span className="hint">{ROLE_LABEL[role]}</span>
        </div>
        <div className="tb-right">
          {canEdit && <button className="mini" onClick={() => onEdit(pageId)}>✎ Edit pages</button>}
          {site.published && !site.private && <a className="mini" href={`/s/${site.slug}`} target="_blank" rel="noreferrer">view live ↗</a>}
        </div>
      </header>
      <div className="pagebar">
        {pages.map(p => (
          <button key={p.id} className={`ptab ${tab === 'pages' && p.id === pageId ? 'on' : ''}`} onClick={() => { setTab('pages'); setPageId(p.id); }}>
            {p.is_home ? '🏠 ' : ''}{p.title}
          </button>
        ))}
        <span className="pagebar-gap" />
        <button className={`ptab ${tab === 'docs' ? 'on' : ''}`} onClick={() => setTab('docs')}>📁 Documents</button>
        <button className={`ptab ${tab === 'people' ? 'on' : ''}`} onClick={() => setTab('people')}>👥 Access</button>
      </div>
      {tab === 'pages' && (
        <iframe className="preview-frame" src={`/api/pages/${pageId}/preview${DEV_AS ? `?as=${DEV_AS}` : ''}`} title={site.name} />
      )}
      {tab === 'docs' && <Documents site={site} role={role} flash={flash} />}
      {tab === 'people' && <Access site={site} me={me} flash={flash} />}
    </div>
  );
}

const size = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function Documents({ site, role, flash }) {
  const [folder, setFolder] = useState('');
  const [lib, setLib] = useState(null);
  const load = useCallback(() => api.library(site.id, folder).then(setLib).catch(flash), [site.id, folder, flash]);
  useEffect(() => { load(); }, [load]);
  if (!lib) return <div className="panel"><p className="hint">Loading…</p></div>;
  if (!lib.id) {
    return (
      <div className="panel">
        <h3>Documents</h3>
        {!lib.linked && <p className="hint">Document libraries live in Drive, which isn't linked to Sites here (set SITES_DRIVE_URL and DRIVE_SVC_TOKEN).</p>}
        {lib.linked && role !== 'owner' && <p className="hint">This site has no document library yet. Its owners can add one.</p>}
        {lib.linked && role === 'owner' && (
          <button className="primary" onClick={async () => { await api.makeLibrary(site.id).catch(flash); load(); }}>Add a document library</button>
        )}
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="crumbs">
          {lib.crumbs.map((c, i) => (
            <span key={c.id || 'top'}>{i > 0 && ' › '}
              {i < lib.crumbs.length - 1 ? <a href="#" onClick={e => { e.preventDefault(); setFolder(c.id || ''); }}>{c.name}</a> : <b>{c.name}</b>}
            </span>
          ))}
        </div>
        {lib.url && <a className="mini" href={lib.url} target="_blank" rel="noreferrer">{lib.canEdit ? 'Upload and manage in Drive ↗' : 'Open in Drive ↗'}</a>}
      </div>
      <table className="files">
        <thead><tr><th>Name</th><th>Modified</th><th>By</th><th>Size</th></tr></thead>
        <tbody>
          {lib.items.map(i => (
            <tr key={i.id}>
              <td>{i.kind === 'folder'
                ? <a href="#" onClick={e => { e.preventDefault(); setFolder(i.id); }}>📁 {i.name}</a>
                : <a href={i.url || '#'} target="_blank" rel="noreferrer">📄 {i.name}</a>}</td>
              <td>{new Date(i.modifiedAt).toLocaleDateString()}</td>
              <td className="hint">{i.modifiedBy}</td>
              <td className="hint">{i.kind === 'folder' ? '' : size(i.size)}</td>
            </tr>
          ))}
          {lib.items.length === 0 && <tr><td colSpan={4} className="hint">Nothing here yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Access({ site, me, flash }) {
  const [data, setData] = useState(null);
  const [who, setWho] = useState('');
  const [role, setRole] = useState('member');
  const [groups, setGroups] = useState([]);
  const load = useCallback(() => api.members(site.id).then(setData).catch(flash), [site.id, flash]);
  useEffect(() => { load(); api.groups().then(setGroups).catch(() => {}); }, [load]);
  if (!data) return <div className="panel"><p className="hint">Loading…</p></div>;
  const run = async p => { try { await p; load(); } catch (e) { flash(e); } };
  return (
    <div className="panel">
      <h3>Who has access</h3>
      <p className="hint">
        {site.private ? 'Private: only the people and groups below can open this site.' : 'Everyone in the organization can read this site. The people below can also edit or manage it.'}
        {' '}Owners manage settings and access, members edit pages and documents, visitors read.
      </p>
      {data.team && (
        <div className="member team-row">
          <span className="avatar">👥</span>
          <span className="grow"><b>{data.team.name || 'Its team'}</b> <span className="hint">team: its owners are site owners, its members are site members</span></span>
        </div>
      )}
      {data.canManage && (
        <form className="add-member" onSubmit={e => { e.preventDefault(); run(api.setMember(site.id, who, role).then(() => setWho(''))); }}>
          <input list="site-groups" placeholder="Email address, or pick a group" value={who} onChange={e => setWho(e.target.value)} required />
          <datalist id="site-groups">{groups.map(g => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}</datalist>
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="owner">Owner</option><option value="member">Member</option><option value="visitor">Visitor</option>
          </select>
          <button className="primary">Add</button>
        </form>
      )}
      {data.members.map(m => (
        <div key={m.principal} className="member">
          <span className="avatar">{m.kind === 'group' ? '👥' : (m.principal[0] || '?').toUpperCase()}</span>
          <span className="grow">
            {m.kind === 'group' ? <><b>{m.name || 'Group'}</b> <span className="hint mono">{m.principal}</span></> : <>{m.principal === me?.email ? 'You' : m.principal}</>}
          </span>
          {data.canManage ? (
            <>
              <select value={m.role} onChange={e => run(api.setMember(site.id, m.principal, e.target.value))}>
                <option value="owner">Owner</option><option value="member">Member</option><option value="visitor">Visitor</option>
              </select>
              <button className="mini danger" onClick={() => run(api.removeMember(site.id, m.principal))}>remove</button>
            </>
          ) : <span className="hint">{ROLE_LABEL[m.role]}</span>}
        </div>
      ))}
    </div>
  );
}
