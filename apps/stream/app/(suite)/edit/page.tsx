import { redirect } from "next/navigation";
import { Editor } from "@/components/Editor";
import { currentUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/** The video editor. ?video=<id> starts with that video; ?project=<id> reopens a saved project. */
export default async function EditPage({ searchParams }: { searchParams: Promise<{ video?: string; project?: string }> }) {
  if (!(await currentUser())) redirect("/signed-out");
  const { video, project } = await searchParams;
  return <Editor videoId={video ?? null} projectId={project ?? null} />;
}
