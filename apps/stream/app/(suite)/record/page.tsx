import { redirect } from "next/navigation";
import { Recorder } from "@/components/Recorder";
import { currentUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function RecordPage() {
  if (!(await currentUser())) redirect("/signed-out");
  return <Recorder />;
}
