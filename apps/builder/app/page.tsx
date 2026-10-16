import { Home } from "@/components/Home";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const me = await currentUser();
  if (!me) return <div className="signed-out">Sign in to the suite to use Builder.</div>;
  return <Home />;
}
