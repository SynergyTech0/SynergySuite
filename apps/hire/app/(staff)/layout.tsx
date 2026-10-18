import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/api";

/** The staff side has the suite header; the careers page doesn't. */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <div className="shell">
      <SuiteBar app="hire" user={who?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
      <div className="suite-main">{children}</div>
    </div>
  );
}
