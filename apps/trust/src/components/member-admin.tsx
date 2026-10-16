'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ROLES = ['owner', 'admin', 'contributor', 'auditor', 'viewer'] as const;

const ROLE_HELP: Record<string, string> = {
  owner: 'Full control, including other owners.',
  admin: 'Manages members, controls and evidence.',
  contributor: 'Edits controls and evidence. Cannot manage members.',
  auditor: 'Read-only, enforced by the database. Intended for an external assessor.',
  viewer: 'Read-only, enforced by the database.',
};

type Member = {
  user_id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  last_login_at: string | null;
};

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(key: string, url: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'That change was refused.');
        return null;
      }
      router.refresh();
      return body;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, send };
}

function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mx-4 mt-3 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad">
      {error}
    </p>
  ) : null;
}

export function MemberList({
  members,
  meUserId,
  canManageOwners,
}: {
  members: Member[];
  meUserId: string;
  canManageOwners: boolean;
}) {
  const { busy, error, send } = useSend();

  return (
    <div>
      <ErrorNote error={error} />
      <ul className="divide-y divide-line">
        {members.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">
                {m.name || m.email}
                {m.user_id === meUserId ? <span className="text-ink-3"> · you</span> : null}
              </p>
              <p className="truncate text-xs text-ink-3">
                {m.email}
                {m.status !== 'active' ? ` · ${m.status}` : ''}
                {m.last_login_at
                  ? ` · last visit ${new Date(m.last_login_at).toISOString().slice(0, 10)}`
                  : ''}
              </p>
            </div>

            <select
              aria-label={`Role for ${m.email}`}
              value={m.role}
              disabled={busy === m.user_id || (m.role === 'owner' && !canManageOwners)}
              onChange={(e) =>
                send(m.user_id, `/api/members/${m.user_id}`, {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ role: e.target.value }),
                })
              }
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
            >
              {ROLES.filter((r) => r !== 'owner' || canManageOwners || m.role === 'owner').map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={busy === m.user_id || (m.role === 'owner' && !canManageOwners)}
              onClick={() => send(m.user_id, `/api/members/${m.user_id}`, { method: 'DELETE' })}
              className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink disabled:opacity-40"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <dl className="border-t border-line px-4 py-3 text-xs">
        {ROLES.map((r) => (
          <div key={r} className="flex gap-2 py-0.5">
            <dt className="w-24 shrink-0 font-medium text-ink-2">{r}</dt>
            <dd className="text-ink-3">{ROLE_HELP[r]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function PendingList({
  pending,
}: {
  pending: { id: string; email: string; role: string; created_at: string }[];
}) {
  const { busy, error, send } = useSend();
  return (
    <div>
      <ErrorNote error={error} />
      <ul className="divide-y divide-line">
        {pending.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">{p.email}</p>
              <p className="text-xs text-ink-3">
                {p.role} · added {p.created_at.slice(0, 10)}
              </p>
            </div>
            <button
              type="button"
              disabled={busy === p.id}
              onClick={() => send(p.id, `/api/invitations/${p.id}`, { method: 'DELETE' })}
              className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink disabled:opacity-40"
            >
              Withdraw
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AddMemberForm({ canAddOwner }: { canAddOwner: boolean }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('contributor');
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, send } = useSend();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(null);
    const body = await send('add', '/api/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    if (body) {
      setDone(
        body.status === 'joined'
          ? `${body.email} is now a member.`
          : `${body.email} will join as ${body.role} the next time they open Trust.`,
      );
      setEmail('');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="email"
          required
          aria-label="Email"
          placeholder="person@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
        <select
          aria-label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        >
          {ROLES.filter((r) => r !== 'owner' || canAddOwner).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy === 'add'}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy === 'add' ? 'Adding…' : 'Add'}
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="rounded-md border border-ok/30 bg-ok-soft px-3 py-2 text-xs text-ok">{done}</p>
      ) : null}

      <p className="text-xs text-ink-3">
        Use the address they sign in to the suite with. Nothing is sent to them; they get
        access the next time they open Trust.
      </p>
    </form>
  );
}
