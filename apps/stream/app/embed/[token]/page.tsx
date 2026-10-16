import { EmbedPlayer } from "@/components/EmbedPlayer";

export const dynamic = "force-dynamic";

/** Just the player, for putting a linked video on a site page (Sites, or anywhere else). */
export default async function EmbedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <EmbedPlayer token={token} />;
}
