import { redirect } from "next/navigation";
import { TodoApp } from "@/components/TodoApp";
import { currentUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  return <TodoApp me={me} />;
}
