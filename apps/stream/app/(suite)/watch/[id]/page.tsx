import { redirect } from "next/navigation";
import { Watch } from "@/components/Watch";
import { currentUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const { id } = await params;
  return <Watch id={id} me={me.email} />;
}
