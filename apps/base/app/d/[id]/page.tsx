import { notFound } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { getDatabase, listTables } from "@/lib/catalog";
import { listForms } from "@/lib/forms";
import { listQueries } from "@/lib/queries";
import { listReports } from "@/lib/reports";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DatabasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ table?: string | string[] }> }) {
  const { id } = await params;
  // ?table=<id> opens that table first (links from the suite's search).
  const { table } = await searchParams;
  const me = await currentUser();
  if (!me) return <p className="signed-out">Sign in to open this database.</p>;
  const database = await getDatabase(id, me.email);
  if (!database) notFound();
  return <Workspace database={database} tables={await listTables(id, me.email)} queries={await listQueries(id, me.email)} forms={await listForms(id, me.email)} reports={await listReports(id, me.email)} me={me.email} initialTable={typeof table === "string" ? table : undefined} />;
}
