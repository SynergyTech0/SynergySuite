import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/api";

/** Every page but the embeddable player sits under the suite header. */
export default async function SuiteLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <div className="suite-body">
      <SuiteBar app="stream" user={who?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
      <div className="suite-main">{children}</div>
    </div>
  );
}
