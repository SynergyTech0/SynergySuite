import { redirect } from "next/navigation";
import { PostPage } from "@/components/PostPage";
import { currentUser } from "@/lib/api";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) redirect("/signed-out");
  const { id } = await params;
  return <PostPage key={id} id={id} />;
}
