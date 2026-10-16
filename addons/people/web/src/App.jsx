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
  employees: () => req('GET', '/api/employees'),
  createEmployee: e => req('POST', '/api/employees', e),
  updateEmployee: (id, e) => req('PATCH', `/api/employees/${id}`, e),
  pto: mine => req('GET', `/api/pto${mine ? '?mine=1' : ''}`),
  requestPto: p => req('POST', '/api/pto', p),
  decide: (id, status) => req('POST', `/api/pto/${id}/decide`, { status }),
  cancel: id => req('POST', `/api/pto/${id}/cancel`),
};

const fmtD = d => new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
const KINDS = ['vacation', 'sick', 'personal', 'other'];

export default function App() {
  const [me, setMe] = useState(null);
  const [view, setView] = useState('pto');
  const [employees, setEmployees] = useState([]);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ kind: 'vacation', startDate: '', endDate: '', note: '' });
  const [empEditor, setEmpEditor] = useState(null);
  const [error, setError] = useState('');
  const flash = useCallback(e => { setError(String(e.message || e)); setTimeout(() => setError(''), 5000); }, []);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
      setEmployees(await api.employees());
      setRequests(await api.pto(false));
    } catch (e) { flash(e); }
  }, [flash]);

  useEffect(() => { refresh(); }, []); // eslint-disable-line

  const pending = requests.filter(r => r.status === 'pending');

  return (
    <div className="wrap">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span> SynergyPeople</div>
        <div>
          <button className={`tab ${view === 'pto' ? 'on' : ''}`} onClick={() => setView('pto')}>PTO</button>
          <button className={`tab ${view === 'dir' ? 'on' : ''}`} onClick={() => setView('dir')}>Directory</button>
          <span className="hint">{me?.email}</span>
        </div>
      </header>

      {view === 'pto' && (
        <>
          {me?.balance && (
            <div className="balance">
              <span><b>{me.balance.remaining}</b> vacation days left</span>
              <span className="hint">{me.balance.used} used of {me.balance.allowance} this year</span>
            </div>
          )}
          {!me?.balance && <p className="hint">You're not in the employee directory yet — ask an admin to add you.</p>}

          <h2>Request time off</h2>
          <div className="add-row">
            <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
              {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
            <input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
            <input placeholder="Note (optional)" className="grow" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
            <button className="primary" disabled={!form.startDate || !form.endDate}
              onClick={async () => {
                try { await api.requestPto(form); setForm({ kind: 'vacation', startDate: '', endDate: '', note: '' }); refresh(); }
                catch (e) { flash(e); }
              }}>Request</button>
          </div>

          {me?.admin && pending.length > 0 && (
            <>
              <h2>Pending approval ({pending.length})</h2>
              {pending.map(r => (
                <div key={r.id} className="req">
                  <b>{r.employee_email.split('@')[0]}</b> · {r.kind} · {fmtD(r.start_date)}–{fmtD(r.end_date)} ({r.days}d)
                  {r.note && <span className="hint"> — {r.note}</span>}
                  <span className="req-actions">
                    <button className="good" onClick={() => api.decide(r.id, 'approved').then(refresh).catch(flash)}>Approve</button>
                    <button className="bad" onClick={() => api.decide(r.id, 'denied').then(refresh).catch(flash)}>Deny</button>
                  </span>
                </div>
              ))}
            </>
          )}

          <h2>{me?.admin ? 'All requests' : 'My requests'}</h2>
          {requests.map(r => (
            <div key={r.id} className={`req st-${r.status}`}>
              <b>{r.employee_email.split('@')[0]}</b> · {r.kind} · {fmtD(r.start_date)}–{fmtD(r.end_date)} ({r.days}d) ·
              <span className={`badge b-${r.status}`}>{r.status}</span>
              {r.employee_email === me?.email && ['pending', 'approved'].includes(r.status) && (
                <button className="mini" onClick={() => api.cancel(r.id).then(refresh).catch(flash)}>cancel</button>
              )}
            </div>
          ))}
          {requests.length === 0 && <p className="hint">No requests yet.</p>}
        </>
      )}

      {view === 'dir' && (
        <>
          <div className="page-head">
            <h2>Directory</h2>
            {me?.admin && <button className="primary" onClick={() => setEmpEditor({})}>+ Add employee</button>}
          </div>
          <table className="table">
            <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Manager</th><th>Status</th></tr></thead>
            <tbody>
              {employees.map(e => (
                <tr key={e.id} onClick={() => me?.admin && setEmpEditor(e)} className={me?.admin ? 'clickable' : ''}>
                  <td>{e.name}</td><td>{e.title || '—'}</td><td>{e.email}</td>
                  <td>{e.manager_email?.split('@')[0] || '—'}</td>
                  <td>{e.active ? '🟢' : '⚪ inactive'}</td>
                </tr>
              ))}
              {employees.length === 0 && <tr><td colSpan="5" className="empty-row">No employees yet.</td></tr>}
            </tbody>
          </table>
        </>
      )}

      {empEditor && (
        <EmpEditor emp={empEditor.id ? empEditor : null} onClose={() => setEmpEditor(null)}
          onSave={async payload => {
            try {
              empEditor.id ? await api.updateEmployee(empEditor.id, payload) : await api.createEmployee(payload);
              setEmpEditor(null); refresh();
            } catch (e) { flash(e); }
          }} />
      )}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}

function EmpEditor({ emp, onClose, onSave }) {
  const [f, setF] = useState({
    email: emp?.email || '', name: emp?.name || '', title: emp?.title || '',
    managerEmail: emp?.manager_email || '', phone: emp?.phone || '',
    startDate: emp?.start_date?.slice(0, 10) || '', ptoDays: emp?.pto_days_per_year || 15,
    emergencyContact: emp?.emergency_contact || '', notes: emp?.notes || '',
    active: emp ? emp.active : true,
  });
  const set = p => setF(prev => ({ ...prev, ...p }));
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{emp ? `Edit ${emp.name}` : 'Add employee'}</h3>
        {!emp && <label>Email <input autoFocus value={f.email} onChange={e => set({ email: e.target.value })} /></label>}
        <label>Name <input value={f.name} onChange={e => set({ name: e.target.value })} /></label>
        <label>Title <input value={f.title} onChange={e => set({ title: e.target.value })} /></label>
        <label>Manager email <input value={f.managerEmail} onChange={e => set({ managerEmail: e.target.value })} /></label>
        <label>Phone <input value={f.phone} onChange={e => set({ phone: e.target.value })} /></label>
        <label>Start date <input type="date" value={f.startDate} onChange={e => set({ startDate: e.target.value })} /></label>
        <label>PTO days / year <input type="number" step="0.5" value={f.ptoDays} onChange={e => set({ ptoDays: e.target.value })} /></label>
        <label>Emergency contact <input value={f.emergencyContact} onChange={e => set({ emergencyContact: e.target.value })} /></label>
        <label>Notes <input value={f.notes} onChange={e => set({ notes: e.target.value })} /></label>
        {emp && <label className="row"><input type="checkbox" checked={f.active} onChange={e => set({ active: e.target.checked })} /> active</label>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!f.name.trim() || (!emp && !f.email.includes('@'))}
            onClick={() => onSave({ ...f, startDate: f.startDate || null, ptoDays: Number(f.ptoDays) })}>Save</button>
        </div>
      </div>
    </div>
  );
}
