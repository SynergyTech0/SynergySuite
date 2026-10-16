'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'implemented', label: 'Implemented' },
  { value: 'not_applicable', label: 'Not applicable' },
] as const;

export function ControlEditor({
  controlKey,
  status,
  naRationale,
  notes,
}: {
  controlKey: string;
  status: string;
  naRationale: string | null;
  notes: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    status,
    na_rationale: naRationale ?? '',
    notes: notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    form.status !== status ||
    form.na_rationale !== (naRationale ?? '') ||
    form.notes !== (notes ?? '');

  async function save() {
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/controls/${encodeURIComponent(controlKey)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: form.status,
        na_rationale: form.na_rationale || null,
        notes: form.notes || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Surface the server's reason verbatim. The API rejects an unjustified N/A, and
      // paraphrasing that into "something went wrong" would hide the actual requirement.
      setError(body.error ?? `Request failed (${res.status})`);
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="status" className="block text-xs font-medium text-ink-2">
          Implementation status
        </label>
        <select
          id="status"
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
          className="mt-1 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {form.status === 'not_applicable' ? (
        <div>
          <label htmlFor="na" className="block text-xs font-medium text-ink-2">
            Why is this not applicable? <span className="text-bad">Required</span>
          </label>
          <textarea
            id="na"
            rows={3}
            value={form.na_rationale}
            onChange={(e) => setForm({ ...form, na_rationale: e.target.value })}
            placeholder="e.g. No physical offices — all infrastructure is cloud-hosted and covered by the provider's SOC 2 report."
            className="mt-1 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
          <p className="mt-1 text-xs text-ink-3">
            An N/A without a documented reason is the most common first-audit finding, so the
            database refuses to store one.
          </p>
        </div>
      ) : null}

      <div>
        <label htmlFor="notes" className="block text-xs font-medium text-ink-2">
          Implementation notes
        </label>
        <textarea
          id="notes"
          rows={4}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="How this control actually operates here, and where an auditor can see it."
          className="mt-1 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
        />
      </div>

      {error ? (
        <p className="rounded-md border border-bad/30 bg-bad-soft px-2.5 py-2 text-xs text-bad">
          {error}
        </p>
      ) : null}
      {saved && !dirty ? (
        <p className="rounded-md border border-ok/30 bg-ok-soft px-2.5 py-2 text-xs text-ok">
          Saved, and recorded in the audit log.
        </p>
      ) : null}

      <button
        type="button"
        onClick={save}
        disabled={!dirty || pending}
        className="w-full rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {pending ? 'Saving…' : dirty ? 'Save change' : 'No changes'}
      </button>
      <p className="text-xs text-ink-3">
        Every change writes an entry to the hash-chained audit log in the same transaction.
      </p>
    </div>
  );
}
