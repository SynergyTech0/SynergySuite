import { redirect } from "next/navigation";
import { FeedScreen } from "@/components/FeedPage";
import { currentUser } from "@/lib/api";

export default async function Page() {
  if (!(await currentUser())) redirect("/signed-out");
  return <FeedScreen />;
}
