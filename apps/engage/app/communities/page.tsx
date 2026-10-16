import { redirect } from "next/navigation";
import { CommunitiesPage } from "@/components/CommunitiesPage";
import { currentUser } from "@/lib/api";

export default async function Page() {
  if (!(await currentUser())) redirect("/signed-out");
  return <CommunitiesPage />;
}
