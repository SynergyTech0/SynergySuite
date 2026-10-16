import { notFound } from "next/navigation";
import { currentUser } from "@/lib/session";
import { getFile } from "@/lib/store";
import { Editor } from "@/components/Editor";

export const dynamic = "force-dynamic";

/** /edit/<id> opens a file from the library; /edit/new starts with an empty editor. */
export default async function Edit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) return <main className="library"><p>Sign in to use Photo.</p></main>;
  if (id === "new") return <Editor file={null} />;
  const file = await getFile(me.subject, id);
  if (!file) notFound();
  return <Editor file={file} />;
}
