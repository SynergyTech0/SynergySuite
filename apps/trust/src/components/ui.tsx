// Shared presentational pieces. Server components — no client JS needed for any of these.

import Link from 'next/link';
import type { ReqStatus } from '@/lib/queries';

// ── status vocabulary ──────────────────────────────────────────────────────────
// Label text is part of the signal, not decoration. Colour alone would make these
// unreadable for red/green colour blindness, and ambiguous in print or a screenshot.

const REQ_STATUS: Record<ReqStatus, { label: string; cls: string }> = {
  implemented: { label: 'Implemented', cls: 'bg-ok-soft text-ok border-ok/30' },
  partial: { label: 'Partial', cls: 'bg-warn-soft text-warn border-warn/30' },
  mapped_only: { label: 'Mapped, not done', cls: 'bg-info-soft text-info border-info/30' },
  unmapped: { label: 'No control', cls: 'bg-bad-soft text-bad border-bad/30' },
  not_applicable: { label: 'N/A', cls: 'bg-mute-soft text-mute border-mute/30' },
};

const CONTROL_STATUS: Record<string, { label: string; cls: string }> = {
  implemented: { label: 'Implemented', cls: 'bg-ok-soft text-ok border-ok/30' },
  in_progress: { label: 'In progress', cls: 'bg-warn-soft text-warn border-warn/30' },
  not_started: { label: 'Not started', cls: 'bg-mute-soft text-mute border-mute/30' },
  not_applicable: { label: 'N/A', cls: 'bg-mute-soft text-mute border-mute/30' },
};

const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  pass: { label: 'Pass', cls: 'bg-ok-soft text-ok border-ok/30' },
  fail: { label: 'Fail', cls: 'bg-bad-soft text-bad border-bad/30' },
  // Distinct from Fail on purpose: nothing was measured, so the control is unproven
  // rather than proven-bad. Collapsing the two is how a monitor starts lying.
  error: { label: 'Not measured', cls: 'bg-warn-soft text-warn border-warn/30' },
  skipped: { label: 'Skipped', cls: 'bg-mute-soft text-mute border-mute/30' },
};

const COVERAGE: Record<string, { label: string; cls: string }> = {
  full: { label: 'Full', cls: 'bg-ok-soft text-ok border-ok/30' },
  partial: { label: 'Partial', cls: 'bg-warn-soft text-warn border-warn/30' },
  supporting: { label: 'Supporting', cls: 'bg-info-soft text-info border-info/30' },
};

const OBLIGATION: Record<string, { label: string; cls: string; hint: string }> = {
  required: { label: 'Required', cls: 'bg-mute-soft text-ink-2 border-line', hint: 'Mandatory' },
  addressable: {
    label: 'Addressable',
    cls: 'bg-info-soft text-info border-info/30',
    // The single most-misread word in HIPAA.
    hint: 'Not optional — implement it, or document why it is not reasonable and appropriate and what you did instead',
  },
  optional: {
    label: 'Optional category',
    cls: 'bg-mute-soft text-mute border-mute/30',
    hint: 'Only applies if this category is selected into scope',
  },
};

function Pill({ label, cls, title }: { label: string; cls: string; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${cls}`}
    >
      {label}
    </span>
  );
}

export function ReqStatusBadge({ status }: { status: ReqStatus }) {
  const s = REQ_STATUS[status];
  return <Pill label={s.label} cls={s.cls} />;
}

export function ControlStatusBadge({ status }: { status: string }) {
  const s = CONTROL_STATUS[status] ?? { label: status, cls: 'bg-mute-soft text-mute border-mute/30' };
  return <Pill label={s.label} cls={s.cls} />;
}

export function RunStatusBadge({ status }: { status: string | null }) {
  if (!status) return <Pill label="Never run" cls="bg-mute-soft text-mute border-mute/30" />;
  const s = RUN_STATUS[status] ?? { label: status, cls: 'bg-mute-soft text-mute border-mute/30' };
  return <Pill label={s.label} cls={s.cls} />;
}

export function CoverageBadge({ coverage }: { coverage: string }) {
  const s = COVERAGE[coverage] ?? { label: coverage, cls: 'bg-mute-soft text-mute border-mute/30' };
  return <Pill label={s.label} cls={s.cls} title={`${s.label} coverage of this requirement`} />;
}

export function ObligationBadge({ obligation }: { obligation: string }) {
  const s = OBLIGATION[obligation] ?? OBLIGATION.required;
  return <Pill label={s.label} cls={s.cls} title={s.hint} />;
}

export function FrameworkTag({ k }: { k: string }) {
  const names: Record<string, string> = {
    soc2: 'SOC 2',
    iso27001: 'ISO 27001',
    hipaa: 'HIPAA',
    gdpr: 'GDPR',
  };
  return (
    <span className="inline-flex shrink-0 items-center rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
      {names[k] ?? k}
    </span>
  );
}

// ── layout primitives ─────────────────────────────────────────────────────────

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-line bg-surface-2/60 ${className}`}>{children}</div>
  );
}

export function CardHead({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-ink-3">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow?: string;
  title: string;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {sub ? <p className="mt-1 max-w-3xl text-sm text-ink-2">{sub}</p> : null}
      </div>
      {right}
    </header>
  );
}

/** A labelled proportion bar. Always shows the raw counts — a bare percentage hides the n. */
export function Meter({
  segments,
  total,
}: {
  segments: { key: string; n: number; cls: string; label: string }[];
  total: number;
}) {
  if (!total) return <div className="h-2 rounded-full bg-mute-soft" />;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-mute-soft" role="img"
         aria-label={segments.map((s) => `${s.label}: ${s.n} of ${total}`).join(', ')}>
      {segments
        .filter((s) => s.n > 0)
        .map((s) => (
          <div
            key={s.key}
            className={s.cls}
            style={{ width: `${(s.n / total) * 100}%` }}
            title={`${s.label}: ${s.n} of ${total}`}
          />
        ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'ink',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ink' | 'ok' | 'warn' | 'bad';
}) {
  const toneCls = { ink: 'text-ink', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' }[tone];
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`tnum mt-0.5 text-2xl font-semibold ${toneCls}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-ink-3">{children}</p>;
}

export function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2.5 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {label}
    </Link>
  );
}

export function when(d: Date | string | null | undefined) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

export function ago(d: Date | string | null | undefined) {
  if (!d) return 'never';
  const date = typeof d === 'string' ? new Date(d) : d;
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}
