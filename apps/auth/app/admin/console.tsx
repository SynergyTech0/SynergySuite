'use client';

import { useEffect, useState } from 'react';

async function post(url: string, data: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export default function AdminConsole() {
  const [tab, setTab] = useState<'users' | 'clients' | 'audit' | 'settings'>('users');
  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {(['users', 'clients', 'audit', 'settings'] as const).map((t) => (
          <button key={t} className={`inline ${tab === t ? '' : 'secondary'}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'users' && <Users />}
      {tab === 'clients' && <Clients />}
      {tab === 'audit' && <Audit />}
      {tab === 'settings' && <Settings />}
    </>
  );
}

type SettingsData = {
  keys: { kid: string; active: boolean; created_ms: number }[];
  api_tokens: { hash8: string; name: string; revoked: boolean }[];
  saml_sps: { id: string; entity_id: string; acs_url: string; slo_url: string | null; name: string }[];
};

function Settings() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [newToken, setNewToken] = useState('');
  const [sp, setSp] = useState({ name: '', entity_id: '', acs_url: '', slo_url: '' });
  const [msg, setMsg] = useState('');

  const load = async () => {
    const r = await fetch('/api/admin/settings');
    if (r.ok) setData(await r.json());
  };
  useEffect(() => { load(); }, []);

  const act = async (payload: Record<string, string>, after?: (body: Record<string, string>) => void) => {
    const r = await post('/api/admin/settings', payload);
    if (r.status === 200) { after?.(r.body); setMsg(''); }
    else setMsg(r.body.error ?? 'failed');
    load();
  };

  if (!data) return null;
  return (
    <>
      {msg && <div className="error">{msg}</div>}
      <div className="panel">
        <h2>Token signing keys</h2>
        <p className="sub">The newest key signs new tokens; older keys stay published in the JWKS so outstanding tokens keep verifying.</p>
        <table style={{ marginBottom: 10 }}>
          <thead><tr><th>kid</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>
            {data.keys.map((k) => (
              <tr key={k.kid}>
                <td className="mono">{k.kid}</td>
                <td><span className={`pill ${k.active ? 'on' : 'off'}`}>{k.active ? 'signing' : 'verify-only'}</span></td>
                <td>{new Date(k.created_ms).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="inline" onClick={() => act({ action: 'rotate_key' })}>Rotate signing key</button>
      </div>

      <div className="panel">
        <h2>SCIM provisioning tokens</h2>
        <p className="sub">Bearer tokens for the SCIM 2.0 API at <code className="k">/api/scim/v2</code> (Okta/Entra user provisioning).</p>
        {newToken && (
          <div className="notice">Token (copy now — shown only once): <code className="k">{newToken}</code></div>
        )}
        <table style={{ marginBottom: 10 }}>
          <thead><tr><th>Name</th><th>Token</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.api_tokens.map((t) => (
              <tr key={t.hash8}>
                <td>{t.name}</td>
                <td className="mono">{t.hash8}…</td>
                <td><span className={`pill ${t.revoked ? 'bad' : 'on'}`}>{t.revoked ? 'revoked' : 'active'}</span></td>
                <td>{!t.revoked && <button className="inline secondary" onClick={() => act({ action: 'revoke_api_token', hash8: t.hash8 })}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="inline" onClick={() => act({ action: 'create_api_token', name: 'scim' }, (b) => setNewToken(b.token))}>
          Create SCIM token
        </button>
      </div>

      <div className="panel">
        <h2>SAML service providers</h2>
        <p className="sub">
          IdP metadata: <a href="/api/saml/metadata" target="_blank">/api/saml/metadata</a>
        </p>
        <table style={{ marginBottom: 10 }}>
          <thead><tr><th>Name</th><th>Entity ID</th><th>ACS URL</th><th /></tr></thead>
          <tbody>
            {data.saml_sps.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="mono">{s.entity_id}</td>
                <td className="mono">{s.acs_url}</td>
                <td><button className="inline secondary" onClick={() => act({ action: 'delete_saml_sp', sp_id: s.id })}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid2">
          <div>
            <label>Name</label>
            <input value={sp.name} onChange={(e) => setSp({ ...sp, name: e.target.value })} />
            <label>Entity ID</label>
            <input value={sp.entity_id} onChange={(e) => setSp({ ...sp, entity_id: e.target.value })} />
          </div>
          <div>
            <label>ACS URL (HTTP-POST)</label>
            <input value={sp.acs_url} onChange={(e) => setSp({ ...sp, acs_url: e.target.value })} />
            <label>SLO URL (optional, HTTP-Redirect)</label>
            <input value={sp.slo_url} onChange={(e) => setSp({ ...sp, slo_url: e.target.value })} />
          </div>
        </div>
        <button className="inline" style={{ marginTop: 12 }} onClick={() => act({ action: 'add_saml_sp', ...sp })}>Register SP</button>
      </div>
    </>
  );
}

type U = { id: string; email: string; name: string; role: string; disabled: boolean; mfa_enabled: boolean };

function Users() {
  const [users, setUsers] = useState<U[]>([]);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'user' });
  const [msg, setMsg] = useState('');

  const load = async () => {
    const r = await fetch('/api/admin/users');
    if (r.ok) setUsers((await r.json()).users);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const r = await post('/api/admin/users', { action: 'create', ...form });
    setMsg(r.status === 200 ? `Created ${form.email}` : (r.body.message ?? r.body.error ?? 'failed'));
    if (r.status === 200) setForm({ email: '', name: '', password: '', role: 'user' });
    load();
  };

  const act = async (action: string, userId: string) => {
    let extra: Record<string, string> = {};
    if (action === 'reset_password') {
      const pw = prompt('New password (12+ chars, letter+digit):');
      if (!pw) return;
      extra = { password: pw };
    }
    const r = await post('/api/admin/users', { action, user_id: userId, ...extra });
    setMsg(r.status === 200 ? 'Done' : (r.body.message ?? r.body.error ?? 'failed'));
    load();
  };

  return (
    <>
      <div className="panel">
        <h2>Create user</h2>
        {msg && <div className="notice">{msg}</div>}
        <div className="grid2">
          <div>
            <label>Email</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label>Password</label>
            <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <label>Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
        </div>
        <button className="inline" style={{ marginTop: 14 }} onClick={create}>Create</button>
      </div>
      <div className="panel">
        <h2>Users</h2>
        <table>
          <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>MFA</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td><span className={`pill ${u.disabled ? 'bad' : 'on'}`}>{u.disabled ? 'disabled' : 'active'}</span></td>
                <td><span className={`pill ${u.mfa_enabled ? 'on' : 'off'}`}>{u.mfa_enabled ? 'on' : 'off'}</span></td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="inline secondary" onClick={() => act(u.disabled ? 'enable' : 'disable', u.id)}>
                    {u.disabled ? 'Enable' : 'Disable'}
                  </button>
                  <button className="inline secondary" onClick={() => act('reset_password', u.id)}>Reset pw</button>
                  <button className="inline secondary" onClick={() => act('reset_mfa', u.id)}>Reset MFA</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type C = { id: string; client_id: string; name: string; redirect_uris: string[]; first_party: boolean; public_client: boolean; disabled: boolean };

function Clients() {
  const [clients, setClients] = useState<C[]>([]);
  const [form, setForm] = useState({ name: '', redirect_uris: '', first_party: '1', public_client: '0', client_credentials: '0' });
  const [secret, setSecret] = useState<{ id: string; secret: string | null } | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const r = await fetch('/api/admin/clients');
    if (r.ok) setClients((await r.json()).clients);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const r = await post('/api/admin/clients', { action: 'create', ...form });
    if (r.status === 200) {
      setSecret({ id: r.body.client_id, secret: r.body.client_secret });
      setMsg('');
    } else setMsg(r.body.error ?? 'failed');
    load();
  };

  const toggle = async (c: C) => {
    await post('/api/admin/clients', { action: c.disabled ? 'enable' : 'disable', client_id: c.client_id });
    load();
  };

  return (
    <>
      <div className="panel">
        <h2>Register application</h2>
        {msg && <div className="error">{msg}</div>}
        {secret && (
          <div className="notice">
            Client created: <code className="k">{secret.id}</code><br />
            {secret.secret
              ? <>Secret (copy now — shown only once): <code className="k">{secret.secret}</code></>
              : 'Public client (PKCE) — no secret.'}
          </div>
        )}
        <label>Application name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label>Redirect URIs (one per line)</label>
        <textarea rows={2} value={form.redirect_uris} onChange={(e) => setForm({ ...form, redirect_uris: e.target.value })} />
        <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 13 }}>
          <label style={{ margin: 0 }}>
            <input type="checkbox" style={{ width: 'auto', marginRight: 6 }}
              checked={form.first_party === '1'}
              onChange={(e) => setForm({ ...form, first_party: e.target.checked ? '1' : '0' })} />
            First-party (skip consent)
          </label>
          <label style={{ margin: 0 }}>
            <input type="checkbox" style={{ width: 'auto', marginRight: 6 }}
              checked={form.public_client === '1'}
              onChange={(e) => setForm({ ...form, public_client: e.target.checked ? '1' : '0' })} />
            Public client (PKCE, no secret)
          </label>
          <label style={{ margin: 0 }}>
            <input type="checkbox" style={{ width: 'auto', marginRight: 6 }}
              checked={form.client_credentials === '1'}
              onChange={(e) => setForm({ ...form, client_credentials: e.target.checked ? '1' : '0' })} />
            Allow client_credentials
          </label>
        </div>
        <button className="inline" style={{ marginTop: 14 }} onClick={create}>Register</button>
      </div>
      <div className="panel">
        <h2>Applications</h2>
        <table>
          <thead><tr><th>Name</th><th>client_id</th><th>Redirect URIs</th><th>Type</th><th /></tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="mono">{c.client_id}</td>
                <td className="mono">{(c.redirect_uris ?? []).join(', ')}</td>
                <td>
                  <span className={`pill ${c.first_party ? 'on' : 'off'}`}>{c.first_party ? '1st party' : '3rd party'}</span>{' '}
                  <span className={`pill ${c.public_client ? 'off' : 'on'}`}>{c.public_client ? 'public' : 'confidential'}</span>
                  {c.disabled && <span className="pill bad"> disabled</span>}
                </td>
                <td><button className="inline secondary" onClick={() => toggle(c)}>{c.disabled ? 'Enable' : 'Disable'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type A = { at_ms: number; actor: string; event: string; detail: unknown; ip: string };

function Audit() {
  const [events, setEvents] = useState<A[]>([]);
  useEffect(() => {
    fetch('/api/admin/audit').then(async (r) => { if (r.ok) setEvents((await r.json()).events); });
  }, []);

  return (
    <div className="panel">
      <h2>Audit log (latest 200)</h2>
      <table>
        <thead><tr><th>Time</th><th>Event</th><th>Actor</th><th>Detail</th></tr></thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.at_ms).toLocaleString()}</td>
              <td><code className="k">{e.event}</code></td>
              <td>{e.actor}</td>
              <td className="mono">{JSON.stringify(e.detail)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
