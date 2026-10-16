'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type CollectorKind = {
  kind: string;
  version: string;
  title: string;
  description: string;
  defaultSeverity: string;
  requiresHostAccess: boolean;
  selfReferential: boolean;
  suggestedControls: string[];
};

const SCHEDULES = ['hourly', 'daily', 'weekly', 'monthly'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const field = 'mt-1 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink';

// Starting config per kind, so the form opens with something that validates rather than an
// empty object the server will reject.
const TEMPLATES: Record<string, unknown> = {
  tls_endpoint: { hosts: ['example.com'], port: 443, min_days_remaining: 21 },
  backup_recoverable: { host: '203.0.113.1', backup_root: '/var/backups', max_age_hours: 36 },
  port_exposure: { hosts: ['203.0.113.1'], expected_open: [443] },
  ssh_hardening: { hosts: ['203.0.113.1'] },
  capacity_headroom: { hosts: ['203.0.113.1'], max_disk_pct: 85, min_mem_available_pct: 10 },
  audit_integrity: { max_silence_hours: 168 },
  http_security_headers: { urls: ['https://example.com'] },
  dependency_vulns: { directories: ['/srv/app'], sla_days: { critical: 7, high: 30 } },
  patch_currency: { hosts: ['203.0.113.1'], max_security_updates: 0 },
};

export function NewMonitorForm({
  kinds,
  controls,
}: {
  kinds: CollectorKind[];
  controls: { key: string; title: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(kinds[0]?.kind ?? '');
  const [form, setForm] = useState({
    key: '',
    title: '',
    control_key: '',
    schedule: 'daily',
    severity: '',
  });
  const [configText, setConfigText] = useState(
    JSON.stringify(TEMPLATES[kinds[0]?.kind ?? ''] ?? {}, null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const collector = kinds.find((k) => k.kind === kind);

  function pickKind(next: string) {
    setKind(next);
    setConfigText(JSON.stringify(TEMPLATES[next] ?? {}, null, 2));
    const suggested = kinds.find((k) => k.kind === next)?.suggestedControls ?? [];
    const match = suggested.find((c) => controls.some((x) => x.key === c));
    setForm((f) => ({ ...f, control_key: match ?? f.control_key, severity: '' }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let config: unknown;
      try {
        config = JSON.parse(configText);
      } catch (err) {
        setError(`Configuration is not valid JSON: ${(err as Error).message}`);
        return;
      }
      const res = await fetch('/api/monitors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          severity: form.severity || undefined,
          kind,
          config,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server's reason explains a real requirement — pass it through verbatim.
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setOpen(false);
      setForm({ key: '', title: '', control_key: '', schedule: 'daily', severity: '' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
      >
        New monitor
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="w-full space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="kind" className="block text-xs font-medium text-ink-2">
            Collector
          </label>
          <select id="kind" value={kind} onChange={(e) => pickKind(e.target.value)} className={field}>
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.kind}
              </option>
            ))}
          </select>
          {collector ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-3">{collector.description}</p>
          ) : null}
          {collector?.requiresHostAccess ? (
            <p className="mt-1 text-xs text-warn">
              Needs credentials into the monitored infrastructure.
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="control" className="block text-xs font-medium text-ink-2">
              Control this evidences
            </label>
            <select
              id="control"
              required
              value={form.control_key}
              onChange={(e) => setForm({ ...form, control_key: e.target.value })}
              className={field}
            >
              <option value="">Choose a control…</option>
              {controls.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.key} — {c.title.slice(0, 48)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="schedule" className="block text-xs font-medium text-ink-2">
                Cadence
              </label>
              <select
                id="schedule"
                value={form.schedule}
                onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                className={field}
              >
                {SCHEDULES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="severity" className="block text-xs font-medium text-ink-2">
                Severity
              </label>
              <select
                id="severity"
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
                className={field}
              >
                <option value="">default ({collector?.defaultSeverity})</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="mkey" className="block text-xs font-medium text-ink-2">
            Identifier
          </label>
          <input
            id="mkey"
            required
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            placeholder="tls-customer-portal"
            className={`${field} hash`}
          />
          <p className="mt-1 text-xs text-ink-3">Lowercase, digits and hyphens. Cannot be changed later.</p>
        </div>
        <div>
          <label htmlFor="mtitle" className="block text-xs font-medium text-ink-2">
            Title
          </label>
          <input
            id="mtitle"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="TLS enforcement on the customer portal"
            className={field}
          />
        </div>
      </div>

      <div>
        <label htmlFor="config" className="block text-xs font-medium text-ink-2">
          Configuration
        </label>
        <textarea
          id="config"
          rows={8}
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          className={`${field} hash`}
        />
        <p className="mt-1 text-xs text-ink-3">
          Validated against the collector before it is saved, so a mistake is an error now
          rather than a monitor that records a failure every night until someone reads the
          history.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad"
        >
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Creating…' : 'Create monitor'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function MonitorControls({
  monitorKey,
  enabled,
  schedule,
  severity,
  config,
}: {
  monitorKey: string;
  enabled: boolean;
  schedule: string;
  severity: string;
  config: unknown;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ schedule, severity });
  const [configText, setConfigText] = useState(JSON.stringify(config, null, 2));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(patch: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/monitors/${encodeURIComponent(monitorKey)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: body.error ?? `Request failed (${res.status})` });
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configText);
    } catch (err) {
      setMsg({ ok: false, text: `Configuration is not valid JSON: ${(err as Error).message}` });
      return;
    }
    if (await send({ ...form, config: parsed })) {
      setMsg({ ok: true, text: 'Saved. The change is in the audit log.' });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink">{enabled ? 'Enabled' : 'Disabled'}</p>
          <p className="text-xs text-ink-3">
            {enabled
              ? 'Collected on its cadence by the scheduled run.'
              : 'Not collected. Existing evidence is kept — it cannot be removed.'}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ enabled: !enabled })}
          className="shrink-0 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
        >
          {enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
        <div>
          <label htmlFor="sch" className="block text-xs font-medium text-ink-2">
            Cadence
          </label>
          <select
            id="sch"
            value={form.schedule}
            onChange={(e) => setForm({ ...form, schedule: e.target.value })}
            className={field}
          >
            {SCHEDULES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sev" className="block text-xs font-medium text-ink-2">
            Severity
          </label>
          <select
            id="sev"
            value={form.severity}
            onChange={(e) => setForm({ ...form, severity: e.target.value })}
            className={field}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="cfg" className="block text-xs font-medium text-ink-2">
          Configuration
        </label>
        <textarea
          id="cfg"
          rows={10}
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          className={`${field} hash`}
        />
      </div>

      {msg ? (
        <p
          role="alert"
          className={`rounded-md border px-2.5 py-2 text-xs ${
            msg.ok ? 'border-ok/30 bg-ok-soft text-ok' : 'border-bad/30 bg-bad-soft text-bad'
          }`}
        >
          {msg.text}
        </p>
      ) : null}

      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="w-full rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save changes'}
      </button>
      <p className="text-xs text-ink-3">
        The collector cannot be changed. A run history produced by two different measurements
        under one identity is a series you cannot interpret.
      </p>
    </div>
  );
}
