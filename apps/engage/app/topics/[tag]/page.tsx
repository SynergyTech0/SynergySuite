import { redirect } from "next/navigation";
import { TopicPage } from "@/components/TopicPage";
import { currentUser } from "@/lib/api";

export default async function Page({ params }: { params: Promise<{ tag: string }> }) {
  if (!(await currentUser())) redirect("/signed-out");
  const tag = decodeURIComponent((await params).tag).toLowerCase();
  return <TopicPage key={tag} topic={tag} />;
}
