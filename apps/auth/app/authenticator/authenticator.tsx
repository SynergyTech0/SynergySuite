'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  type Account, generateCode, secondsRemaining, parseOtpauth, isValidBase32,
} from './totp-client';

const STORE_KEY = 'synergy_authenticator_accounts_v1';

function load(): Account[] {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
}
function save(accs: Account[]) { localStorage.setItem(STORE_KEY, JSON.stringify(accs)); }
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export default function Authenticator() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(30);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState('');
  const [ready, setReady] = useState(false);

  const persist = useCallback((next: Account[]) => { setAccounts(next); save(next); }, []);

  const addAccount = useCallback((partial: Omit<Account, 'id'>) => {
    const acc: Account = { ...partial, id: uid() };
    setAccounts((prev) => {
      const dup = prev.find((a) => a.secret === acc.secret && a.issuer === acc.issuer && a.label === acc.label);
      if (dup) return prev;
      const next = [...prev, acc];
      save(next);
      return next;
    });
    setToast(`Added ${partial.issuer}`);
  }, []);

  // initial load + consume ?add=/​?otpauth= deep link (one-tap add from enrollment)
  useEffect(() => {
    setAccounts(load());
    setReady(true);
    const p = new URLSearchParams(window.location.search);
    const uri = p.get('add') || p.get('otpauth');
    if (uri) {
      try { addAccount(parseOtpauth(uri)); } catch { setToast('Could not read that account link'); }
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, '', url.toString());
    }
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register('/authenticator-sw.js', { scope: '/authenticator/' }).catch(() => {});
    }
  }, [addAccount]);

  // tick: refresh codes + countdown every 500ms
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const tick = async () => {
      const now = Date.now();
      setRemaining(secondsRemaining(30, now));
      const entries = await Promise.all(
        accounts.map(async (a) => [a.id, await generateCode(a, now)] as const),
      );
      if (!cancelled) setCodes(Object.fromEntries(entries));
    };
    tick();
    const iv = setInterval(tick, 500);
    return () => { cancelled = true; clearInterval(iv); };
  }, [accounts, ready]);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2000); return () => clearTimeout(t); } }, [toast]);

  const remove = (id: string) => { if (confirm('Remove this account?')) persist(accounts.filter((a) => a.id !== id)); };
  const copy = (id: string) => { navigator.clipboard?.writeText((codes[id] || '').replace(/\s/g, '')); setToast('Code copied'); };

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: '20px 16px 60px' }}>
      <div className="brand" style={{ marginBottom: 6 }}>
        <img className="logo" src="/synergy-mark.png" alt="" width={34} height={34} />
        <h1>Synergy Authenticator</h1>
      </div>
      <p className="sub">Your one-time codes are generated on this device and never leave it.</p>

      {toast && <div className="notice" data-testid="toast">{toast}</div>}

      {accounts.length === 0 && !adding && (
        <div className="panel" style={{ textAlign: 'center' }}>
          <p className="sub" style={{ marginBottom: 14 }}>No accounts yet. Add one to start generating codes.</p>
          <button className="inline" onClick={() => setAdding(true)}>Add account</button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {accounts.map((a) => (
          <div key={a.id} className="panel" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 14, padding: 16 }}>
            <Ring remaining={remaining} period={a.period} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.issuer}{a.label && a.label !== a.issuer ? ` · ${a.label}` : ''}
              </div>
              <div
                data-testid="code"
                onClick={() => copy(a.id)}
                title="Tap to copy"
                style={{ fontSize: 30, fontFamily: 'Consolas, monospace', letterSpacing: 3, cursor: 'pointer', lineHeight: 1.2 }}
              >
                {fmt(codes[a.id])}
              </div>
            </div>
            <button className="inline secondary" style={{ padding: '6px 10px' }} onClick={() => remove(a.id)}>✕</button>
          </div>
        ))}
      </div>

      {accounts.length > 0 && !adding && (
        <button className="inline" style={{ marginTop: 16 }} onClick={() => setAdding(true)}>Add account</button>
      )}

      {adding && <AddPanel onAdd={(p) => { addAccount(p); setAdding(false); }} onClose={() => setAdding(false)} />}
    </div>
  );
}

function fmt(code: string | undefined): string {
  if (!code) return '••• •••';
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}

function Ring({ remaining, period }: { remaining: number; period: number }) {
  const r = 13, c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, remaining / period));
  const low = remaining <= 5;
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-label={`${remaining}s`}>
      <circle cx="17" cy="17" r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
      <circle
        cx="17" cy="17" r={r} fill="none" strokeWidth="3" strokeLinecap="round"
        stroke={low ? 'var(--bad)' : 'var(--accent)'}
        strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
        transform="rotate(-90 17 17)"
      />
      <text x="17" y="21" textAnchor="middle" fontSize="11" fill="var(--text)">{remaining}</text>
    </svg>
  );
}

function AddPanel({ onAdd, onClose }: { onAdd: (p: Omit<Account, 'id'>) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'choose' | 'scan' | 'manual'>('choose');
  const [issuer, setIssuer] = useState('');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState('');
  const scanSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  const submitManual = () => {
    if (!isValidBase32(secret)) { setErr('That secret key doesn’t look valid (base32).'); return; }
    onAdd({ issuer: issuer.trim() || 'Account', label: label.trim() || issuer.trim() || 'account', secret: secret.replace(/\s/g, ''), digits: 6, period: 30, algorithm: 'SHA1' });
  };

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Add account</h2>
        <button className="inline secondary" style={{ padding: '4px 10px' }} onClick={onClose}>Close</button>
      </div>
      {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}

      {mode === 'choose' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          <button className="inline" onClick={() => setMode(scanSupported ? 'scan' : 'manual')}>
            {scanSupported ? 'Scan QR code' : 'Scan QR (not supported here)'}
          </button>
          <button className="inline secondary" onClick={() => setMode('manual')}>Enter a setup key manually</button>
          <p className="sub" style={{ margin: 0 }}>
            On the SynergyAuth setup screen you can also tap <strong>Add to Synergy Authenticator</strong> to add it in one step.
          </p>
        </div>
      )}

      {mode === 'scan' && <Scanner onFound={onAdd} onError={(m) => { setErr(m); setMode('manual'); }} />}

      {mode === 'manual' && (
        <div style={{ marginTop: 8 }}>
          <label>Service name</label>
          <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="SynergyAuth" />
          <label>Account (email/username)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="you@company.com" />
          <label>Setup key (secret)</label>
          <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="JBSWY3DPEHPK3PXP" style={{ fontFamily: 'Consolas, monospace' }} />
          <button className="inline" style={{ marginTop: 14 }} onClick={submitManual}>Add</button>
        </div>
      )}
    </div>
  );
}

function Scanner({ onFound, onError }: { onFound: (p: Omit<Account, 'id'>) => void; onError: (m: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        // @ts-expect-error BarcodeDetector is not in the TS DOM lib yet
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const scan = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(v);
            if (codes[0]?.rawValue) {
              try { onFound(parseOtpauth(codes[0].rawValue)); return; }
              catch { onError('That QR code isn’t a TOTP setup code.'); return; }
            }
          } catch { /* frame not ready */ }
          raf = requestAnimationFrame(scan);
        };
        raf = requestAnimationFrame(scan);
      } catch {
        onError('Camera unavailable — enter the setup key manually.');
      }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onFound, onError]);

  return (
    <div style={{ marginTop: 12 }}>
      <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 10, background: '#000', aspectRatio: '1' }} />
      <p className="sub" style={{ marginTop: 8 }}>Point the camera at the QR code on the SynergyAuth setup screen.</p>
    </div>
  );
}
