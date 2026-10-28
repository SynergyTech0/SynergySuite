'use client';

import { useEffect, useRef, useState } from 'react';

type State =
  | { kind: 'sending' }
  | { kind: 'waiting'; number: number }
  | { kind: 'denied' | 'expired' | 'unavailable' | 'rate_limited' | 'done' };

/*
 * "Approve on your phone": asks the server to send the approval, shows the number to pick, then
 * long-polls the server until the Pager decides. The server alone decides and sets the session.
 */
export default function PushApprove({ returnTo }: { returnTo: string }) {
  const [state, setState] = useState<State>({ kind: 'sending' });
  const attempt = useRef(0);

  const post = (body: Record<string, string | number>) =>
    fetch('/api/auth/mfa/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const send = async () => {
    const mine = ++attempt.current;
    setState({ kind: 'sending' });
    let number: number;
    try {
      const res = await post({ action: 'start' });
      const data = await res.json();
      if (res.status === 429) return setState({ kind: 'rate_limited' });
      if (!res.ok || typeof data.number !== 'number') return setState({ kind: 'unavailable' });
      number = data.number;
    } catch {
      return setState({ kind: 'unavailable' });
    }
    setState({ kind: 'waiting', number });

    while (attempt.current === mine) {
      let data: { status?: string; redirect?: string };
      try {
        const res = await post({ action: 'check', wait: 20, return_to: returnTo });
        if (res.status === 401) {
          window.location.href = `/login?return_to=${encodeURIComponent(returnTo)}`;
          return;
        }
        data = await res.json();
      } catch {
        return setState({ kind: 'unavailable' });
      }
      if (attempt.current !== mine) return;
      if (data.status === 'approved') {
        setState({ kind: 'done' });
        window.location.href = data.redirect ?? '/account';
        return;
      }
      if (data.status === 'denied' || data.status === 'expired' || data.status === 'unavailable') {
        return setState({ kind: data.status });
      }
      if (data.status !== 'pending') return setState({ kind: 'expired' });
    }
  };

  useEffect(() => {
    send();
    return () => { attempt.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = <button type="button" className="secondary" onClick={send}>Send a new request</button>;

  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ marginTop: 0 }}>Approve on your phone</label>
      {state.kind === 'sending' && <p className="sub">Sending a sign-in request to your phone…</p>}
      {state.kind === 'waiting' && (
        <div className="notice" role="status">
          Open Synergy Globe and pick <strong style={{ fontSize: 22, letterSpacing: 1 }}>{state.number}</strong>
          <div style={{ marginTop: 6 }}>Waiting for your approval. This request ends in 2 minutes.</div>
        </div>
      )}
      {state.kind === 'done' && <div className="notice" role="status">Approved. Signing you in…</div>}
      {state.kind === 'denied' && (
        <>
          <div className="error" role="alert">The request was denied on your phone. If that wasn&apos;t you, change your password.</div>
          {retry}
        </>
      )}
      {state.kind === 'expired' && (
        <>
          <div className="error" role="alert">The request timed out before it was approved.</div>
          {retry}
        </>
      )}
      {state.kind === 'rate_limited' && (
        <div className="error" role="alert">Too many sign-in requests were sent to your phone. Wait a few minutes, or use a code below.</div>
      )}
      {state.kind === 'unavailable' && (
        <>
          <div className="error" role="alert">Phone approval isn&apos;t reachable right now. Use a code from your authenticator app or a backup code below.</div>
          {retry}
        </>
      )}
    </div>
  );
}
