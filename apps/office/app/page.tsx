import { q } from "@/lib/db";
import { identity } from "@/lib/identity";
import DocList, { type Doc } from "@/components/DocList";

export const dynamic = "force-dynamic";

async function loadDocs(org: string, email: string): Promise<Doc[]> {
  try {
    return await q<Doc>(
      `SELECT d.id, d.kind, d.title, d.snippet, d.owner_email, d.scope, d.updated_at,
              (g.email IS NOT NULL) AS shared
       FROM documents d
       LEFT JOIN doc_grants g ON g.doc_id = d.id AND g.email = $2
       WHERE d.org = $1 AND (d.owner_email = $2 OR d.scope = 'company' OR g.email IS NOT NULL)
       ORDER BY d.updated_at DESC LIMIT 300`,
      [org, email],
    );
  } catch {
    // A transient DB issue shouldn't take down the whole page.
    return [];
  }
}

export default async function Home() {
  const me = await identity();
  const docs = me.email ? await loadDocs(me.org, me.email) : [];

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center">
          <span className="font-extrabold tracking-tight text-[17px]">
            Synergy<span className="text-indigo-600">Docs</span>
          </span>
          <span className="ml-3 text-xs text-slate-400">Collaborative documents</span>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">
        <DocList docs={docs} me={me.email || "guest"} />
      </main>
    </div>
  );
}
