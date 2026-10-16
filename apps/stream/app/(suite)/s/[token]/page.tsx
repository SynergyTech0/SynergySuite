import { SharedWatch } from "@/components/SharedWatch";

export const dynamic = "force-dynamic";

/** What someone opening a video's link sees. No account needed. */
export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedWatch token={token} />;
}
