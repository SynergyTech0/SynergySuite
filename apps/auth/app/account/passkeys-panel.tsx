'use client';

import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';

async function post(data: Record<string, string>) {
  const res = await fetch('/api/account/passkeys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

type Passkey = { cred_id8: string; name: string; created_ms: number };

export default function PasskeysPanel() {
  const [keys, setKeys] = useState<Passkey[]>([]);
  const [msg, setMsg] = useState<{ kind: 'error' | 'notice'; text: string } | null>(null);

  const load = async () => {
    const r = await fetch('/api/account/passkeys');
    if (r.ok) setKeys((await r.json()).passkeys);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    setMsg(null);
    try {
      const opt = await post({ action: 'register_options' });
      if (opt.status !== 200) throw new Error('options');
      const attestation = await startRegistration({ optionsJSON: opt.body.options });
      const name = prompt('Name this passkey (e.g. "Windows Hello", "iPhone"):') || 'Passkey';
      const ver = await post({ action: 'register_verify', response: JSON.stringify(attestation), name });
      if (ver.status === 200) {
        setMsg({ kind: 'notice', text: 'Passkey added.' });
        load();
      } else setMsg({ kind: 'error', text: 'Verification failed.' });
    } catch {
      setMsg({ kind: 'error', text: 'Passkey setup was cancelled or is not supported on this device.' });
    }
  };

  const remove = async (prefix: string) => {
    await post({ action: 'delete', cred_id8: prefix });
    load();
  };

  return (
    <div className="panel">
      <h2>Passkeys</h2>
      {msg && <div className={msg.kind}>{msg.text}</div>}
      <p className="sub">Sign in without a password using Windows Hello, Touch ID, or a security key.</p>
      {keys.length > 0 && (
        <table style={{ marginBottom: 10 }}>
          <thead><tr><th>Name</th><th>Added</th><th /></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.cred_id8}>
                <td>{k.name}</td>
                <td>{new Date(k.created_ms).toLocaleDateString()}</td>
                <td><button className="inline secondary" onClick={() => remove(k.cred_id8)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="inline" onClick={add}>Add a passkey</button>
    </div>
  );
}
