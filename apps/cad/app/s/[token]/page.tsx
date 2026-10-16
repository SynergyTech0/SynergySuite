import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/session";
import { sharedView } from "@/lib/share";
import { isOwner, openShare } from "@/lib/store";
import { Shared } from "@/components/Shared";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

/** The title and description link previews (Mail, Chat) show for a pasted share link. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const open = await openShare((await params).token);
  if (!open) return { title: "Synergy CAD", robots: { index: false } };
  const title = `${open.file.name} · Synergy CAD`;
  const description = "A drawing shared for review. Open it to view it and leave comments.";
  return { title, description, robots: { index: false }, openGraph: { title, description, siteName: "Synergy CAD" } };
}

/** /s/<token>: a shared file, view only, with its review comments. Open to anyone holding the link. */
export default async function SharedPage({ params }: Props) {
  const { token } = await params;
  const open = await openShare(token);
  if (!open) notFound();
  const me = await currentUser();
  return <Shared token={token} initial={sharedView(open.file, open.share, !!me && isOwner(open.share, me.subject))} signedInAs={me ? me.name || me.email : null} />;
}
