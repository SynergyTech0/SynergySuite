'use client';

import { useEffect, useState } from 'react';
import PasskeysPanel from './passkeys-panel';

async function post(url: string, data: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export default function AccountPanels({ mfaEnabled, demo = false }: { mfaEnabled: boolean; demo?: boolean }) {
  // The shared demo account (demo mode) can't change its credentials; only its session is shown.
  if (demo) return <SessionsPanel />;
  return (
    <div className="grid2">
      <div>
        <MfaPanel mfaEnabled={mfaEnabled} />
        <PasskeysPanel />
      </div>
      <div>
        <PasswordPanel />
        <SessionsPanel />
      </div>
    </div>
  );
}

function MfaPanel({ mfaEnabled }: { mfaEnabled: boolean }) {
  const [enroll, setEnroll] = useState<{ qr_data_url: string; secret: string; otpauth_url: string } | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'notice'; text: string } | null>(null);
  const [enabled, setEnabled] = useState(mfaEnabled);

  const start = async () => {
    setMsg(null);
    const r = await post('/api/account/mfa', { action: 'enroll' });
    if (r.status === 200) setEnroll(r.body);
    else setMsg({ kind: 'error', text: 'Could not start enrollment.' });
  };

  const verify = async () => {
    const r = await post('/api/account/mfa', { action: 'verify', code });
    if (r.status === 200) {
      setEnabled(true);
      setEnroll(null);
      setBackupCodes(r.body.backup_codes);
      setMsg({ kind: 'notice', text: 'MFA is now enabled. Save your backup codes — they are shown only once.' });
    } else {
      setMsg({ kind: 'error', text: 'Code did not match. Scan the QR and try again.' });
    }
  };

  const disable = async () => {
    const c = prompt('Enter a current 6-digit code to disable MFA:');
    if (!c) return;
    const r = await post('/api/account/mfa', { action: 'disable', code: c });
    if (r.status === 200) {
      setEnabled(false);
      setBackupCodes(null);
      setMsg({ kind: 'notice', text: 'MFA disabled.' });
    } else setMsg({ kind: 'error', text: 'Invalid code — MFA not disabled.' });
  };

  const regen = async () => {
    const c = prompt('Enter a current 6-digit code to regenerate backup codes:');
    if (!c) return;
    const r = await post('/api/account/mfa', { action: 'backup_codes', code: c });
    if (r.status === 200) {
      setBackupCodes(r.body.backup_codes);
      setMsg({ kind: 'notice', text: 'New backup codes generated. Previous codes no longer work.' });
    } else setMsg({ kind: 'error', text: 'Invalid code.' });
  };

  return (
    <div className="panel">
      <h2>Two-factor authentication</h2>
      {msg && <div className={msg.kind}>{msg.text}</div>}
      {backupCodes && (
        <>
          <p style={{ fontSize: 13 }}>Backup codes (each works once):</p>
          <div className="codes">{backupCodes.map((c) => <span key={c}>{c}</span>)}</div>
        </>
      )}
      {!enabled && !enroll && (
        <>
          <p className="sub">
            Protect your account with the <a href="/authenticator" target="_blank">Synergy Authenticator</a> app
            (or any authenticator — Google Authenticator, 1Password, Authy).
          </p>
          <button className="inline" onClick={start}>Set up MFA</button>
        </>
      )}
      {enroll && (
        <>
          <a className="btn" href={`/authenticator?add=${encodeURIComponent(enroll.otpauth_url)}`} target="_blank"
             style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Add to Synergy Authenticator
          </a>
          <p className="sub" style={{ marginTop: 14 }}>Or, on another device, scan this QR with the Synergy Authenticator (or any authenticator app):</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr_data_url} alt="TOTP QR code" style={{ borderRadius: 8, background: '#fff', padding: 6 }} />
          <p className="sub" style={{ marginTop: 10 }}>
            Or enter manually: <code className="k">{enroll.secret}</code>
          </p>
          <p className="sub">Then enter the 6-digit code it shows:</p>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
          <button className="inline" style={{ marginTop: 12 }} onClick={verify}>Verify &amp; enable</button>
        </>
      )}
      {enabled && !enroll && (
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="inline secondary" onClick={regen}>Regenerate backup codes</button>
          <button className="inline danger" onClick={disable}>Disable MFA</button>
        </div>
      )}
    </div>
  );
}

function PasswordPanel() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'notice'; text: string } | null>(null);

  const change = async () => {
    const r = await post('/api/account/password', { current_password: current, new_password: next });
    if (r.status === 200) {
      setMsg({ kind: 'notice', text: 'Password changed.' });
      setCurrent(''); setNext('');
    } else {
      setMsg({ kind: 'error', text: r.body.message ?? 'Current password is wrong.' });
    }
  };

  return (
    <div className="panel">
      <h2>Change password</h2>
      {msg && <div className={msg.kind}>{msg.text}</div>}
      <label>Current password</label>
      <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <label>New password (12+ chars, letter + digit)</label>
      <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
      <button className="inline" style={{ marginTop: 14 }} onClick={change}>Update password</button>
    </div>
  );
}

type SessionInfo = { sid: string; current: boolean; created_ms: number; ip: string; user_agent: string };

function SessionsPanel() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  const load = async () => {
    const res = await fetch('/api/account/sessions');
    if (res.ok) setSessions((await res.json()).sessions);
  };
  useEffect(() => { load(); }, []);

  const revoke = async (prefix: string) => {
    await post('/api/account/sessions', { sid_prefix: prefix });
    load();
  };

  return (
    <div className="panel">
      <h2>Active sessions</h2>
      <table>
        <thead><tr><th>Started</th><th>Device</th><th /></tr></thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.sid}>
              <td>{new Date(s.created_ms).toLocaleString()}{s.current && <span className="pill on" style={{ marginLeft: 6 }}>this device</span>}</td>
              <td className="mono">{(s.user_agent ?? '').slice(0, 40)}</td>
              <td>{!s.current && <button className="inline secondary" onClick={() => revoke(s.sid)}>Revoke</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
