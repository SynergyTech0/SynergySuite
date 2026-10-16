import { auditTrail } from '@/lib/queries';
import { pageSession } from '@/components/guard';
import { Card, Empty, PageHead, when } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const s = await pageSession();

  const { events, intact, break: broken } = await auditTrail(s, 200);

  return (
    <>
      <PageHead
        eyebrow="Audit log"
        title="Activity and integrity"
        sub={
          <>
            Every event is hashed together with its predecessor, so removing or altering one
            breaks every hash after it. The banner below is produced by recomputing the entire
            chain on this request — not read from a stored flag, which would only tell you what
            someone once wrote down.
          </>
        }
      />

      <div
        className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
          intact ? 'border-ok/30 bg-ok-soft text-ok' : 'border-bad/40 bg-bad-soft text-bad'
        }`}
      >
        {intact ? (
          <>
            <strong className="font-semibold">Chain verified intact.</strong> Recomputed from the
            first event to the last.
          </>
        ) : (
          <>
            <strong className="font-semibold">Chain broken at sequence {broken?.broken_at}.</strong>{' '}
            Expected <code className="hash">{broken?.expected}</code>, found{' '}
            <code className="hash">{broken?.found}</code>. Every event from this point on should
            be treated as unreliable.
          </>
        )}
      </div>

      {events.length === 0 ? (
        <Card>
          <Empty>No events recorded.</Empty>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-ink-3">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Seq</th>
                  <th scope="col" className="px-4 py-2 font-medium">When</th>
                  <th scope="col" className="px-4 py-2 font-medium">Actor</th>
                  <th scope="col" className="px-4 py-2 font-medium">Action</th>
                  <th scope="col" className="px-4 py-2 font-medium">Object</th>
                  <th scope="col" className="px-4 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.map((e) => (
                  <tr key={e.seq} className="align-top">
                    <td className="tnum px-4 py-2.5 text-xs text-ink-3">{e.seq}</td>
                    <td className="tnum whitespace-nowrap px-4 py-2.5 text-xs text-ink-2">
                      {when(e.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-2">
                      {e.actor_name ?? e.actor_label ?? 'system'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <code className="hash text-ink">{e.action}</code>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-2">
                      {e.object_type}
                      {e.object_id ? (
                        <span className="text-ink-3"> · {e.object_id.slice(0, 20)}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <code className="hash text-[11px] text-ink-3">
                        {JSON.stringify(e.payload)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
