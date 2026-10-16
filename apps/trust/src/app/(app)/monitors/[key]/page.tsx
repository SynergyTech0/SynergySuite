import Link from 'next/link';
import { notFound } from 'next/navigation';
import { monitorHealth, monitorRuns } from '@/lib/queries';
import { pageSession } from '@/components/guard';
import { RunButton } from '@/components/run-button';
import { MonitorControls } from '@/components/monitor-admin';
import { COLLECTOR_KINDS } from '@/lib/collectors-meta';
import { Card, CardHead, Empty, PageHead, RunStatusBadge, Stat, when } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function MonitorPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const s = await pageSession();

  const [all, runs] = await Promise.all([
    monitorHealth(s),
    monitorRuns(s, key),
  ]);
  const monitor = all.find((m) => m.key === key);
  if (!monitor) notFound();

  const collector = COLLECTOR_KINDS.find((c) => c.kind === monitor.kind);
  const measured = runs.filter((r) => r.status === 'pass' || r.status === 'fail');
  const passed = runs.filter((r) => r.status === 'pass').length;

  return (
    <>
      <PageHead
        eyebrow="Monitor"
        title={monitor.title}
        sub={
          <>
            Control{' '}
            <Link href={`/controls/${monitor.control_key}`} className="text-accent hover:underline">
              <code className="hash">{monitor.control_key}</code>
            </Link>{' '}
            · kind <code className="hash">{monitor.kind}</code> · {monitor.schedule}
          </>
        }
        right={
          <div className="flex items-center gap-3">
            <RunButton monitorKey={monitor.key} />
            <Link href="/monitors" className="text-xs font-medium text-accent hover:underline">
              All monitors
            </Link>
          </div>
        }
      />

      <Card className="mb-4 px-4 py-4">
        <div className="flex flex-wrap items-start gap-8">
          <Stat label="Runs recorded" value={String(runs.length)} hint="most recent 60" />
          <Stat
            label="Measured"
            value={String(measured.length)}
            hint={`${runs.length - measured.length} could not be measured`}
            tone={runs.length - measured.length > 0 ? 'warn' : 'ink'}
          />
          {/* Denominator is measured runs, not all runs. Counting unmeasurable runs as
              passes would inflate the figure; counting them as fails would misreport
              a network outage as a control failure. */}
          <Stat
            label="Pass rate"
            value={measured.length ? `${Math.round((passed / measured.length) * 100)}%` : '—'}
            hint="of runs that actually measured something"
            tone={measured.length && passed === measured.length ? 'ok' : 'warn'}
          />
        </div>
      </Card>

      <Card className="mb-4">
        <CardHead
          title="What this collector measures"
          sub={collector ? `${collector.kind} v${collector.version}` : 'no collector registered for this kind'}
        />
        <div className="px-4 py-3">
          {collector ? (
            <p className="text-sm leading-relaxed text-ink-2">{collector.description}</p>
          ) : (
            <p className="text-sm text-warn">
              No collector is registered for kind <code className="hash">{monitor.kind}</code>.
              Every run will record an error rather than being silently skipped.
            </p>
          )}
          {collector?.requiresHostAccess ? (
            <p className="mt-2 text-xs text-warn">
              Needs credentials into the monitored infrastructure. Fine for a self-hosted
              deployment; a hosted plan should use a customer-installed agent instead of the
              vendor holding keys.
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="mb-4">
        <CardHead title="Settings" sub="Every change is recorded in the audit log" />
        <div className="px-4 py-3">
          {s.readOnly ? (
            <>
              <p className="text-sm text-ink-2">
                The {s.role} role is read-only, so these settings cannot be changed here.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-surface px-3 py-2 text-xs">
                <code className="hash">{JSON.stringify(monitor.config, null, 2)}</code>
              </pre>
            </>
          ) : (
            <MonitorControls
              monitorKey={monitor.key}
              enabled={monitor.enabled}
              schedule={monitor.schedule}
              severity={monitor.severity}
              config={monitor.config}
            />
          )}
        </div>
      </Card>

      <Card>
        <CardHead
          title="Run history"
          sub="Append-only. This series is what an auditor samples to test operating effectiveness across a period."
        />
        {runs.length === 0 ? (
          <Empty>Never run.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {runs.map((r) => (
              <li key={r.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <RunStatusBadge status={r.status} />
                    <span className="text-sm text-ink-2">{r.message}</span>
                  </div>
                  <span className="tnum text-xs text-ink-3">{when(r.started_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
