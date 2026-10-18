import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/api";

/** The agent console. Visitors only ever see the widget, which lives on other sites. */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <div className="shell">
      <SuiteBar app="livechat" user={who?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
      <div className="suite-main">{children}</div>
    </div>
  );
}
