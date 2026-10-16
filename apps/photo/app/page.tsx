import { currentUser } from "@/lib/session";
import { listFiles } from "@/lib/store";
import { Library } from "@/components/Library";

export const dynamic = "force-dynamic";

export default async function Home() {
  const me = await currentUser();
  if (!me) return <main className="library"><p>Sign in to use Photo.</p></main>;
  return <Library initial={await listFiles(me.subject)} />;
}
