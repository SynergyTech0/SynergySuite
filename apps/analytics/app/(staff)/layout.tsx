import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/api";

/** Every page here is for signed-in staff; sites only load the script and post beacons. */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <div className="shell">
      <SuiteBar app="analytics" user={who?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
      <div className="suite-main">{children}</div>
    </div>
  );
}
