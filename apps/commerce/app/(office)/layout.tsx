import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/api";

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <div className="suite-body">
      <SuiteBar app="commerce" user={who?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
      <div className="suite-main">{children}</div>
    </div>
  );
}
