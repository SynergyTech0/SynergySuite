import { Player } from "@/components/Player";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ draft?: string }> }) {
  const me = await currentUser();
  if (!me) return <div className="signed-out">Sign in to the suite to use this app.</div>;
  const { id } = await params;
  const { draft } = await searchParams;
  return <Player id={id} draft={draft === "1"} user={{ email: me.email, name: me.name }} />;
}
