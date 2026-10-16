import { EmbedView } from "@/components/EmbedView";
import { currentUser } from "@/lib/api";
import { collabUrl } from "@/lib/collab-url";

export const dynamic = "force-dynamic";

/** A component on its own, without the suite header, for showing inside Chat and other apps. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  const { id } = await params;
  if (!me) return <p className="embedmsg">Sign in to Synergy to see this Loop component.</p>;
  return <EmbedView id={id} me={me} collabUrl={collabUrl()} />;
}
