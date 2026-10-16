import { redirect } from "next/navigation";
import { CommunityPage } from "@/components/CommunityPage";
import { currentUser } from "@/lib/api";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  if (!(await currentUser())) redirect("/signed-out");
  const { slug } = await params;
  return <CommunityPage key={slug} slug={decodeURIComponent(slug)} />;
}
