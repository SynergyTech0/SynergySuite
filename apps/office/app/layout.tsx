import "./globals.css";
import type { ReactNode } from "react";
import { SuiteBar } from "@/components/SuiteBar";
import { identity } from "@/lib/identity";

export const metadata = {
  title: "SynergyDocs",
  description: "Collaborative documents for the Synergy platform.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const me = await identity();
  return (
    // suppressHydrationWarning: browser extensions (Scribe, theme/dark-mode
    // helpers, etc.) inject attributes onto <html>/<body> before React hydrates;
    // that's benign and shouldn't surface as a console warning.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className="suite-body">
        <SuiteBar app="office" user={me.email} domain={process.env.SUITE_DOMAIN} />
        <div className="suite-main">{children}</div>
      </body>
    </html>
  );
}
