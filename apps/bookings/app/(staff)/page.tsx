import { redirect } from "next/navigation";
import { BookingsApp } from "@/components/BookingsApp";
import { currentUser } from "@/lib/api";
import { publicBase } from "@/lib/suite";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  return <BookingsApp me={me} publicBase={publicBase()} suiteDomain={process.env.SUITE_DOMAIN} />;
}
