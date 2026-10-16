import Link from "next/link";
import type { Article } from "@/lib/types";

// The public help center's frame: article list on the left, the page on the right.
// Server-rendered; no sign-in and no browser code.
export function HelpCenter({ articles, active, children }: { articles: Article[]; active?: string; children: React.ReactNode }) {
  return (
    <div className="help">
      <header className="helpbar">
        <div className="helpbarin">
          <Link href="/kb" className="helpbrand">
            <img src="/app-icon.svg" alt="" width={24} height={24} /> Help center
          </Link>
        </div>
      </header>
      <div className="helpwrap">
        <nav className="helpnav" aria-label="Articles">
          {articles.length ? (
            <ul>
              {articles.map((a) => (
                <li key={a.slug}>
                  <Link href={`/kb/${a.slug}`} className={a.slug === active ? "on" : undefined}>{a.title}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No articles yet.</p>
          )}
        </nav>
        <main className="helpmain">{children}</main>
      </div>
    </div>
  );
}
