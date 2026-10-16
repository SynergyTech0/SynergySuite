import { notFound } from "next/navigation";
import { identity } from "@/lib/identity";
import { docAccess } from "@/lib/access";
import UniverSheet from "@/components/UniverSheet";

export const dynamic = "force-dynamic";

export default async function SheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await identity();
  const a = await docAccess(id, me);
  if (!a || a.doc.kind !== "sheet") notFound();

  const canEdit = a.role === "editor" || a.role === "owner";

  return (
    <div className="h-screen">
      <UniverSheet
        docId={id}
        title={a.doc.title}
        initialSnapshot={a.doc.snapshot ?? null}
        canEdit={canEdit}
        role={a.role}
        starred={a.doc.starred}
        meEmail={me.email}
        meName={me.name}
        collabUrl={process.env.NEXT_PUBLIC_COLLAB_URL || ""}
      />
    </div>
  );
}
