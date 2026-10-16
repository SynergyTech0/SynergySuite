import Link from 'next/link';
import { dashboard, EVIDENCE_WINDOW_DAYS, type FrameworkSummary } from '@/lib/queries';
import { pageSession } from '@/components/guard';
import {
  Card, CardHead, Empty, FrameworkTag, Meter, PageHead, RunStatusBadge, Stat,
  ago, pct, when,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

const SEGMENTS = [
  { key: 'implemented', cls: 'bg-ok', label: 'Implemented' },
  { key: 'partial', cls: 'bg-warn', label: 'Partial' },
  { key: 'mapped_only', cls: 'bg-info', label: 'Mapped, not done' },
  { key: 'unmapped', cls: 'bg-bad', label: 'No control' },
] as const;

function FrameworkCard({ f }: { f: FrameworkSummary }) {
  const denom = f.total - f.counts.not_applicable;
  return (
    <Card>
      <CardHead
        title={f.framework_name}
        sub={
          <>
            {f.status.replace('_', ' ')} · {denom} requirements in scope
            {f.counts.not_applicable ? ` · ${f.counts.not_applicable} N/A` : ''}
          </>
        }
        right={<FrameworkTag k={f.framework_key} />}
      />
      <div className="px-4 py-4">
        <div className="mb-4 flex items-start gap-8">
          <Stat
            label="Implemented"
            value={pct(f.implemented_pct)}
            hint={`${f.counts.implemented} of ${denom}`}
            tone={f.implemented_pct >= 0.9 ? 'ok' : f.implemented_pct >= 0.4 ? 'warn' : 'bad'}
          />
          {/* The number that matters. Implemented-but-unevidenced fails a Type II. */}
          <Stat
            label="Audit ready"
            value={pct(f.audit_ready_pct)}
            hint={`evidenced in ${EVIDENCE_WINDOW_DAYS}d`}
            tone={f.audit_ready_pct >= 0.9 ? 'ok' : f.audit_ready_pct > 0 ? 'warn' : 'bad'}
          />
        </div>

        <Meter
          total={denom}
          segments={SEGMENTS.map((s) => ({ ...s, n: f.counts[s.key] }))}
        />
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          {SEGMENTS.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${s.cls}`} />
              <dt className="text-ink-3">{s.label}</dt>
              <dd className="tnum ml-auto font-medium text-ink-2">{f.counts[s.key]}</dd>
            </div>
          ))}
        </dl>

        {f.scope_note ? (
          <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-3">
            <span className="font-medium text-ink-2">Scope:</span> {f.scope_note}
          </p>
        ) : null}

        <Link
          href={`/frameworks/${f.framework_key}`}
          className="mt-3 inline-block text-xs font-medium text-accent hover:underline"
        >
          Requirement-by-requirement →
        </Link>
      </div>
    </Card>
  );
}

export default async function Overview() {
  const s = await pageSession();

  const { frameworks, monitors, evidence, audit } = await dashboard(s);

  return (
    <>
      <PageHead
        eyebrow="Overview"
        title={s.tenantName}
        sub={
          <>
            Readiness is shown twice on purpose. <strong className="text-ink">Implemented</strong>{' '}
            is what the control owner says; <strong className="text-ink">audit ready</strong>{' '}
            additionally requires evidence collected in the last {EVIDENCE_WINDOW_DAYS} days.
            A Type II opinion tests the second one.
          </>
        }
      />

      {frameworks.length === 0 ? (
        <Card>
          <Empty>
            No frameworks adopted yet. New organisations start with SOC 2 (Common Criteria)
            adopted; add another by inserting a row in{' '}
            <code className="hash">tenant_frameworks</code>.
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {frameworks.map((f) => (
            <FrameworkCard key={f.framework_key} f={f} />
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead
            title="Continuous monitors"
            sub="Automated checks that produce evidence on a schedule"
            right={
              <Link href="/monitors" className="text-xs font-medium text-accent hover:underline">
                All monitors
              </Link>
            }
          />
          {monitors.length === 0 ? (
            <Empty>
              No monitors configured. Without them, every piece of evidence is manual and the
              Type II window has to be filled by hand.
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {monitors.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{m.title}</p>
                    <p className="truncate text-xs text-ink-3">
                      <code className="hash">{m.control_key}</code> · {m.schedule} · last run{' '}
                      {ago(m.last_run)}
                      {m.errors_30d > 0 ? ` · ${m.errors_30d} not measured in 30d` : ''}
                    </p>
                  </div>
                  <RunStatusBadge status={m.last_status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead
            title="Recent evidence"
            sub="Append-only. Corrections supersede, they never overwrite."
            right={
              <Link href="/evidence" className="text-xs font-medium text-accent hover:underline">
                Full ledger
              </Link>
            }
          />
          {evidence.length === 0 ? (
            <Empty>No evidence collected yet.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {evidence.map((e) => (
                <li key={e.id} className="px-4 py-2.5">
                  <p className="truncate text-sm text-ink">{e.title}</p>
                  <p className="truncate text-xs text-ink-3">
                    {e.control_key ? <code className="hash">{e.control_key}</code> : 'unlinked'} ·{' '}
                    {e.kind} · {when(e.collected_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHead
          title="Audit log integrity"
          sub="Hash-chained per tenant. Verified by recomputing the chain on every page load, not cached."
          right={
            <Link href="/audit" className="text-xs font-medium text-accent hover:underline">
              Open log
            </Link>
          }
        />
        <div className="px-4 py-3">
          {audit.intact ? (
            <p className="text-sm text-ok">
              Chain intact across {audit.events.length ? `latest ${audit.events.length} of ` : ''}
              all recorded events.
            </p>
          ) : (
            <p className="text-sm text-bad">
              Chain broken at sequence {audit.break?.broken_at}. Expected{' '}
              <code className="hash">{audit.break?.expected.slice(0, 16)}…</code>, found{' '}
              <code className="hash">{audit.break?.found.slice(0, 16)}…</code>. Treat every event
              after this point as unreliable and investigate immediately.
            </p>
          )}
        </div>
      </Card>
    </>
  );
}
