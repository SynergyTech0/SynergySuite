'use client';

import { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';

export default function PasskeyButton({ returnTo }: { returnTo: string }) {
  const [error, setError] = useState('');

  const signIn = async () => {
    setError('');
    try {
      const optRes = await fetch('/api/auth/passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'options' }),
      });
      const { options, handle } = await optRes.json();
      const assertion = await startAuthentication({ optionsJSON: options });
      const verRes = await fetch('/api/auth/passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', handle, response: JSON.stringify(assertion) }),
      });
      if (verRes.ok) {
        window.location.href = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/account';
      } else {
        setError('Passkey sign-in failed.');
      }
    } catch {
      setError('Passkey sign-in was cancelled or is not available on this device.');
    }
  };

  return (
    <>
      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      <button type="button" className="secondary" onClick={signIn}>Sign in with a passkey</button>
    </>
  );
}
