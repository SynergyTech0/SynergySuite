import { redirect } from "next/navigation";
import { currentUser } from "@/lib/api";
import { importBoard } from "@/lib/boards";
import { readFromDrive } from "@/lib/drive";
import { UserError } from "@/lib/util";
import { parseExcalidraw } from "@/lib/ydoc";

export const dynamic = "force-dynamic";

/**
 * Drive's "Open in Whiteboard" for an .excalidraw file (?drive=<item id>): the file becomes a new
 * board of the person's own, which then opens.
 */
export default async function OpenFromDrive({ searchParams }: { searchParams: Promise<{ drive?: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const { drive } = await searchParams;
  let id: string | null = null;
  let problem = "";
  try {
    if (!drive) throw new UserError("No file was picked");
    const file = await readFromDrive(me, drive);
    id = (await importBoard(me, file.name.replace(/\.excalidraw$/i, "") || "Imported board", parseExcalidraw(file.text))).id;
  } catch (e) {
    if (!(e instanceof UserError)) console.error("[whiteboard] open from Drive", e);
    problem = e instanceof UserError ? e.message : "Something went wrong";
  }
  if (id) redirect(`/b/${id}`);
  return (
    <div className="empty">
      <h1>Can&apos;t open that file</h1>
      <p>{problem}</p>
      <a className="btn" href="/">Back to your boards</a>
    </div>
  );
}
