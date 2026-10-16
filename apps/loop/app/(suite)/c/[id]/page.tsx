import { redirect } from "next/navigation";
import { ComponentWindow } from "@/components/ComponentWindow";
import { currentUser } from "@/lib/api";
import { collabUrl } from "@/lib/collab-url";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  const { id } = await params;
  return <ComponentWindow id={id} me={me} collabUrl={collabUrl()} />;
}
