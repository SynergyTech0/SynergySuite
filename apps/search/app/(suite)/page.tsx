import { redirect } from "next/navigation";
import { SearchApp } from "@/components/SearchApp";
import { currentUser } from "@/lib/api";
import { searchAiConfig } from "@/lib/ask";
import { appName, searchApps } from "@/lib/fanout";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const who = await currentUser();
  if (!who) redirect("/signed-out");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const apps = searchApps().map((id) => ({ id, name: appName(id) }));
  return (
    <SearchApp
      initialQuery={one(sp.q).slice(0, 500)}
      initialTab={one(sp.tab) === "ask" ? "ask" : "results"}
      apps={apps}
      aiOn={(await searchAiConfig()) !== null}
      name={who.name}
    />
  );
}
