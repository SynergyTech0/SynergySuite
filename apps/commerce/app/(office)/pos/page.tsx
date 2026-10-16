import { redirect } from "next/navigation";
import { Register } from "@/components/Register";
import { currentCtx } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata = { title: "Register · Synergy Commerce" };

export default async function Page() {
  const ctx = await currentCtx();
  if (!ctx) redirect("/signed-out");
  return <Register />;
}
