import Link from 'next/link';
import { evidenceLedger } from '@/lib/queries';
import { pageSession } from '@/components/guard';
import { Card, Empty, PageHead, when } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function EvidencePage() {
  const s = await pageSession();

  const rows = await evidenceLedger(s, 200);

  return (
    <>
      <PageHead
        eyebrow="Evidence"
        title="Evidence ledger"
        sub={
          <>
            Append-only, enforced by database trigger rather than convention. A correction
            inserts a superseding row; nothing here can be edited or deleted, including by us.
            Each row carries a SHA-256 of the observation, so drift from what was collected is
            detectable.
          </>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <Empty>
            No evidence yet. Run <code className="hash">npm run collect</code>.
          </Empty>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-ink-3">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Collected</th>
                  <th scope="col" className="px-4 py-2 font-medium">Control</th>
                  <th scope="col" className="px-4 py-2 font-medium">Evidence</th>
                  <th scope="col" className="px-4 py-2 font-medium">Source</th>
                  <th scope="col" className="px-4 py-2 font-medium">SHA-256</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="tnum whitespace-nowrap px-4 py-2.5 text-xs text-ink-2">
                      {when(e.collected_at)}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {e.control_key ? (
                        <Link
                          href={`/controls/${e.control_key}`}
                          className="text-accent hover:underline"
                        >
                          <code className="hash">{e.control_key}</code>
                        </Link>
                      ) : (
                        <span className="text-ink-3">unlinked</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-ink">{e.title}</p>
                      {e.supersedes_id ? (
                        <p className="text-xs text-warn">supersedes an earlier row</p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-2">
                      {e.kind}
                      {e.collector ? (
                        <span className="text-ink-3">
                          {' '}· {e.collector}@{e.collector_version}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <code className="hash text-[11px] text-ink-3">
                        {e.content_hash.slice(0, 24)}…
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
