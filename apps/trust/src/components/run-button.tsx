'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RunButton({ monitorKey }: { monitorKey: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/monitors/${encodeURIComponent(monitorKey)}/run`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-xs text-bad">{error}</span> : null}
      <button
        type="button"
        onClick={run}
        disabled={busy || pending}
        className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
      >
        {busy || pending ? 'Running…' : 'Run now'}
      </button>
    </span>
  );
}
