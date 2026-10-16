import { notFound } from "next/navigation";
import { currentUser } from "@/lib/session";
import { folderPath, getFile } from "@/lib/store";
import { Editor } from "@/components/Editor";

export const dynamic = "force-dynamic";

/** /edit/<id> opens a drawing; /edit/new starts with an empty editor. */
export default async function Edit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ folder?: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) return <main className="library"><p>Sign in to use CAD.</p></main>;
  if (id === "new") return <Editor file={null} folder={folderPath((await searchParams).folder ?? "") ?? ""} />;
  const file = await getFile(me.subject, id);
  if (!file) notFound();
  return <Editor file={file} />;
}
