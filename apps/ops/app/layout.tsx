import "./globals.css";
import type { Metadata } from "next";
import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/api";

export const metadata: Metadata = {
  title: "Synergy Ops",
  description: "Manufacturing and assets: bills of materials, work orders, MRP, the asset register and maintenance.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <html lang="en">
      <body className="suite-body">
        {who && <SuiteBar app="ops" user={who.email} domain={process.env.SUITE_DOMAIN} />}
        <div className="suite-main">{children}</div>
      </body>
    </html>
  );
}
