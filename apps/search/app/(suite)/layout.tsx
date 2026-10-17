import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/api";

/** Search's own pages carry the suite header; the Copilot panel (/copilot) sits inside another app's header instead. */
export default async function SuiteLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <>
      <SuiteBar app="search" user={who?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
      <div className="suite-main">{children}</div>
    </>
  );
}
