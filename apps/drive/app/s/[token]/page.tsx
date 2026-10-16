import { SharedView } from "@/components/SharedView";

export const dynamic = "force-dynamic";

/** What someone opening a view link sees. No account needed. */
export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedView token={token} />;
}
