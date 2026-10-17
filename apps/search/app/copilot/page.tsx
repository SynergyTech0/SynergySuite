import { CopilotPanel } from "@/components/CopilotPanel";
import { currentUser } from "@/lib/api";
import { searchAiConfig } from "@/lib/ask";
import { apps } from "@synergy/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Copilot" };

/** The Copilot side panel, framed by the suite header of every app (see @synergy/shell). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const who = await currentUser();
  if (!who) {
    return (
      <div className="pad">
        <p>Copilot could not tell who you are. Sign in to the suite again, then reopen Copilot.</p>
      </div>
    );
  }
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const app = /^[a-z]{1,20}$/.test(one(sp.app)) ? one(sp.app) : "";
  return (
    <CopilotPanel
      initialApp={app}
      appNames={Object.fromEntries(apps.map((a) => [a.id, a.name]))}
      initialContext={one(sp.context).slice(0, 500)}
      aiOn={(await searchAiConfig()) !== null}
      name={who.name}
      domain={process.env.SUITE_DOMAIN ?? ""}
    />
  );
}
