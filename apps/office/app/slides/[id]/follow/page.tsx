import { notFound } from "next/navigation";
import { identity } from "@/lib/identity";
import { docAccess } from "@/lib/access";
import FollowView from "@/components/slides/FollowView";

export const dynamic = "force-dynamic";

// The audience view: anyone who can open the presentation follows the
// presenter's slide show on their own screen.
export default async function FollowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await identity();
  const a = await docAccess(id, me);
  if (!a || a.doc.kind !== "slide") notFound();
  return <FollowView docId={id} title={a.doc.title} user={{ name: me.name, email: me.email || "guest" }} collabUrl={process.env.NEXT_PUBLIC_COLLAB_URL || ""} />;
}
