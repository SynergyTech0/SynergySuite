import { notFound } from "next/navigation";
import { identity } from "@/lib/identity";
import { docAccess } from "@/lib/access";
import DocEditor from "@/components/Editor";

export const dynamic = "force-dynamic";

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await identity();
  const a = await docAccess(id, me);
  if (!a || a.doc.kind !== "doc") notFound();

  return (
    <DocEditor
      docId={id}
      initialTitle={a.doc.title}
      user={{ name: me.name, email: me.email || "guest" }}
      collabUrl={process.env.NEXT_PUBLIC_COLLAB_URL || ""}
      initialScope={a.doc.scope as "private" | "company"}
      role={a.role}
      initialStarred={a.doc.starred}
    />
  );
}
