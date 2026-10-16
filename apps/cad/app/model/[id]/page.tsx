import { notFound } from "next/navigation";
import { currentUser } from "@/lib/session";
import { folderPath, getFile } from "@/lib/store";
import { Modeler } from "@/components/Modeler";

export const dynamic = "force-dynamic";

/** /model/<id> opens a 3D model (or imports a STEP, IGES, BREP or STL); /model/new starts empty. */
export default async function Model({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ folder?: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) return <main className="library"><p>Sign in to use CAD.</p></main>;
  if (id === "new") return <Modeler file={null} folder={folderPath((await searchParams).folder ?? "") ?? ""} />;
  const file = await getFile(me.subject, id);
  if (!file) notFound();
  return <Modeler file={file} />;
}
