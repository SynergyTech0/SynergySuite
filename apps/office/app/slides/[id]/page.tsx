import { notFound } from "next/navigation";
import { identity } from "@/lib/identity";
import { docAccess } from "@/lib/access";
import SlideEditor from "@/components/SlideEditor";

export const dynamic = "force-dynamic";

export default async function SlidesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await identity();
  const a = await docAccess(id, me);
  if (!a || a.doc.kind !== "slide") notFound();

  const canEdit = a.role === "editor" || a.role === "owner";

  return (
    <div className="h-screen">
      <SlideEditor
        docId={id}
        initialName={a.doc.title}
        user={{ name: me.name, email: me.email || "guest" }}
        collabUrl={process.env.NEXT_PUBLIC_COLLAB_URL || ""}
        canEdit={canEdit}
        role={a.role}
        starred={a.doc.starred}
      />
    </div>
  );
}
