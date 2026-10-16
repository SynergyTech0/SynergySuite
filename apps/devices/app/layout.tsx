import "./globals.css";
import type { Metadata } from "next";
import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/api";

export const metadata: Metadata = {
  title: "Synergy Devices",
  description: "Device inventory, compliance policies, threat alerts, vulnerabilities and live queries.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <html lang="en">
      <body className="suite-body">
        <SuiteBar app="devices" user={who?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
        <div className="suite-main">{children}</div>
      </body>
    </html>
  );
}
