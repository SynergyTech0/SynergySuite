'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Membership = { tenantId: string; slug: string; name: string; role: string };

export function TenantPicker({
  memberships,
  current,
  compact = false,
}: {
  memberships: Membership[];
  current: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(tenantId: string) {
    setBusy(tenantId);
    setError(null);
    try {
      const res = await fetch('/api/tenant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not switch organisation.');
        return;
      }
      router.replace('/');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p role="alert" className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad">
          {error}
        </p>
      ) : null}
      {memberships.map((m) => (
        <button
          key={m.tenantId}
          type="button"
          onClick={() => pick(m.tenantId)}
          disabled={!!busy}
          className={`flex w-full items-center justify-between rounded-md border border-line px-3 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-50 ${
            m.tenantId === current ? 'bg-surface-2' : 'bg-surface'
          }`}
        >
          <span>
            <span className={compact ? 'text-xs text-ink' : 'text-sm text-ink'}>{m.name}</span>
            <span className="block text-[11px] text-ink-3">{m.role}</span>
          </span>
          <span className="text-[11px] text-ink-3">
            {busy === m.tenantId ? 'Switching…' : m.tenantId === current ? 'Current' : ''}
          </span>
        </button>
      ))}
    </div>
  );
}
