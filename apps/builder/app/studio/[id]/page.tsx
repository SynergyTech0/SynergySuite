import { Studio } from "@/components/Studio";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return <div className="signed-out">Sign in to the suite to use Builder.</div>;
  const { id } = await params;
  return <Studio id={id} user={{ email: me.email, name: me.name }} />;
}
