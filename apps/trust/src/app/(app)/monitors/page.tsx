import Link from 'next/link';
import { monitorHealth, controls } from '@/lib/queries';
import { COLLECTOR_KINDS } from '@/lib/collectors-meta';
import { pageSession } from '@/components/guard';
import { NewMonitorForm } from '@/components/monitor-admin';
import { Card, CardHead, Empty, PageHead, RunStatusBadge, Stat, ago } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function MonitorsPage() {
  const s = await pageSession();
  const [rows, allControls] = await Promise.all([monitorHealth(s), controls(s)]);

  const due = rows.filter((m) => m.is_due);
  const failing = rows.filter((m) => m.last_status === 'fail');
  const unmeasured = rows.filter((m) => m.last_status === 'error');

  return (
    <>
      <PageHead
        eyebrow="Monitors"
        title="Continuous monitoring"
        sub={
          <>
            Each monitor produces evidence on a schedule, building the run history a Type II
            audit tests. <strong className="text-ink">Not measured</strong> is tracked
            separately from <strong className="text-ink">Fail</strong> — a check that could
            not run has not passed, and counting it either way would be a lie in one
            direction or the other.
          </>
        }
        right={
          s.readOnly ? null : (
            <NewMonitorForm
              kinds={COLLECTOR_KINDS}
              controls={allControls.map((c) => ({ key: c.key, title: c.title }))}
            />
          )
        }
      />

      <Card className="mb-4 px-4 py-4">
        <div className="flex flex-wrap items-start gap-8">
          <Stat label="Monitors" value={String(rows.length)} hint="enabled" />
          <Stat
            label="Failing"
            value={String(failing.length)}
            hint="measured, and not compliant"
            tone={failing.length ? 'bad' : 'ok'}
          />
          <Stat
            label="Not measured"
            value={String(unmeasured.length)}
            hint="could not be collected"
            tone={unmeasured.length ? 'warn' : 'ok'}
          />
          <Stat
            label="Due now"
            value={String(due.length)}
            hint="cadence elapsed"
            tone={due.length ? 'warn' : 'ok'}
          />
        </div>
        <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3">
          Collection is driven by{' '}
          <code className="hash">node scripts/collect.mjs --due</code> on a schedule.
          Running it by hand fills the window too, but only a scheduled job fills it reliably
          — and an audit window with gaps in it is an audit window with gaps in it.
        </p>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <Empty>
            No monitors configured. Run{' '}
            <code className="hash">node scripts/seed-monitors.mjs</code>.
          </Empty>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((m) => (
              <li key={m.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                  <code className="hash mt-0.5 shrink-0 text-xs font-medium text-accent">
                    {m.key}
                  </code>
                  <p className="min-w-0 flex-1 text-sm font-medium text-ink">{m.title}</p>
                  {m.is_due ? (
                    <span className="inline-flex shrink-0 items-center rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
                      Due
                    </span>
                  ) : null}
                  <RunStatusBadge status={m.last_status} />
                </div>

                <p className="mt-1 text-xs text-ink-3">
                  <Link
                    href={`/controls/${m.control_key}`}
                    className="text-accent hover:underline"
                  >
                    <code className="hash">{m.control_key}</code>
                  </Link>{' '}
                  · <code className="hash">{m.kind}</code> · {m.schedule} · {m.severity}{' '}
                  severity · last run {ago(m.last_run)}
                  {m.next_due_at && !m.is_due ? ` · next due ${ago(m.next_due_at)
                    .replace('ago', 'from now')
                    .replace('today', 'later today')}` : ''}
                </p>

                <p className="tnum mt-0.5 text-xs text-ink-3">
                  last 30d: {m.runs_30d} run{m.runs_30d === 1 ? '' : 's'}
                  {m.fails_30d > 0 ? <span className="text-bad"> · {m.fails_30d} fail</span> : null}
                  {m.errors_30d > 0 ? (
                    <span className="text-warn"> · {m.errors_30d} not measured</span>
                  ) : null}
                </p>

                {m.last_message ? (
                  <p className="mt-1 text-xs text-ink-2">{m.last_message}</p>
                ) : null}

                <Link
                  href={`/monitors/${m.key}`}
                  className="mt-1 inline-block text-xs font-medium text-accent hover:underline"
                >
                  Run history →
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-4">
        <CardHead
          title="Registered collectors"
          sub="Derived from the runtime registry — a kind cannot appear here without code behind it"
        />
        <ul className="divide-y divide-line">
          {COLLECTOR_KINDS.map((k) => (
            <li key={k.kind} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <code className="hash text-xs font-medium text-ink">{k.kind}</code>
                <span className="text-xs text-ink-3">v{k.version}</span>
                {k.selfReferential ? (
                  <span
                    title="Measures Trust's own state. No credentials needed, and the strongest evidence the product can produce."
                    className="inline-flex items-center rounded-full border border-ok/30 bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok"
                  >
                    Self-referential
                  </span>
                ) : null}
                {k.requiresHostAccess ? (
                  <span
                    title="Needs credentials into the monitored infrastructure. Appropriate for a self-hosted deployment or a customer-installed agent; not for a hosted plan where the vendor would hold keys into customer systems."
                    className="inline-flex items-center rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn"
                  >
                    Needs host access
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-ink-2">{k.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{k.description}</p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
