import { redirect } from "next/navigation";
import { PersonPage } from "@/components/PersonPage";
import { currentUser } from "@/lib/api";

export default async function Page({ params }: { params: Promise<{ email: string }> }) {
  if (!(await currentUser())) redirect("/signed-out");
  const email = decodeURIComponent((await params).email);
  return <PersonPage key={email} email={email} />;
}
