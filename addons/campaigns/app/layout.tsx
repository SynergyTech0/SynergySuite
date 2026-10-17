import "./globals.css";
import type { Metadata } from "next";
import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/api";

export const metadata: Metadata = {
  title: "Synergy Campaigns",
  description: "Email marketing: audiences, campaigns, automations and reports.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <html lang="en">
      <body className="suite-body">
        <SuiteBar app="campaigns" user={who?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
        <div className="suite-main">{children}</div>
      </body>
    </html>
  );
}
