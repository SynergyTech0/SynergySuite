import "./globals.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { SuiteBar } from "@/components/SuiteBar";
import { isCompanyAdmin } from "@/lib/access";
import { aiEnabled } from "@/lib/ai";
import { currentUser } from "@/lib/api";

export const metadata: Metadata = {
  title: "Synergy Engage",
  description: "The company home page, feed and communities.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <html lang="en">
      <body className="suite-body">
        <SuiteBar app="engage" user={who?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
        <div className="suite-main">
          {who ? (
            <Suspense>
              <Shell me={{ ...who, admin: isCompanyAdmin(who.email) }} ai={aiEnabled()}>{children}</Shell>
            </Suspense>
          ) : (
            children
          )}
        </div>
      </body>
    </html>
  );
}
