import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { published, publishedBySlug } from "@/lib/kb";
import { renderMarkdown } from "@/lib/markdown";
import { HelpCenter } from "../HelpCenter";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await publishedBySlug((await params).slug);
  return { title: a ? `${a.title} - Help center` : "Help center" };
}

export default async function HelpArticle({ params }: Props) {
  const { slug } = await params;
  const [articles, article] = await Promise.all([published(), publishedBySlug(slug)]);
  if (!article) notFound();
  return (
    <HelpCenter articles={articles} active={slug}>
      <article>
        <h1>{article.title}</h1>
        <p className="muted small">Updated {new Date(article.updatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
        {/* renderMarkdown escapes the article first and only emits a few plain tags. */}
        <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(article.body) }} />
      </article>
    </HelpCenter>
  );
}
