import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/api";

/** The console has the suite header; the public status page (under /status) doesn't. */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <div className="shell">
      <SuiteBar app="status" user={who?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
      <div className="suite-main">{children}</div>
    </div>
  );
}
