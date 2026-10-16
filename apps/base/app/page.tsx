import { Home } from "@/components/Home";
import { listDatabases } from "@/lib/catalog";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const me = await currentUser();
  if (!me) return <p className="signed-out">Sign in to see your databases.</p>;
  return <Home databases={await listDatabases(me.email)} />;
}
