import { currentUser } from "@/lib/session";
import { folderPath, listFiles, listFolders } from "@/lib/store";
import { Library } from "@/components/Library";

export const dynamic = "force-dynamic";

/** The library; `?folder=Projects/Site A` opens a folder. */
export default async function Home({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const me = await currentUser();
  if (!me) return <main className="library"><p>Sign in to use CAD.</p></main>;
  const folders = await listFolders(me.subject);
  const asked = folderPath((await searchParams).folder ?? "") ?? "";
  const folder = folders.includes(asked) ? asked : "";
  return <Library key={folder} initial={await listFiles(me.subject)} folders={folders} folder={folder} />;
}
