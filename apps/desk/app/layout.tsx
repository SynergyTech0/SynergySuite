import "./globals.css";
import type { Metadata } from "next";
import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/api";

export const metadata: Metadata = {
  title: "Synergy Desk",
  description: "Help desk: email tickets, canned replies and a public knowledge base.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <html lang="en">
      <body className="suite-body">
        {/* Customers reading the public help center aren't suite users: no suite header for them. */}
        {who && <SuiteBar app="desk" user={who.email} domain={process.env.SUITE_DOMAIN} />}
        <div className="suite-main">{children}</div>
      </body>
    </html>
  );
}
