import Link from "next/link";
import type { Metadata } from "next";
import { published } from "@/lib/kb";
import { excerpt } from "@/lib/markdown";
import { HelpCenter } from "./HelpCenter";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Help center" };

export default async function HelpIndex() {
  const articles = await published();
  return (
    <HelpCenter articles={articles}>
      <h1>How can we help?</h1>
      {articles.length ? (
        <ul className="helplist">
          {articles.map((a) => (
            <li key={a.slug}>
              <Link href={`/kb/${a.slug}`}>{a.title}</Link>
              {excerpt(a.body) && <p className="muted">{excerpt(a.body)}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">There are no help articles yet.</p>
      )}
    </HelpCenter>
  );
}
