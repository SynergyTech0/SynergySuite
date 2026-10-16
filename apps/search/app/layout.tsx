import "./globals.css";
import type { Metadata } from "next";
import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/api";

export const metadata: Metadata = {
  title: "Synergy Search",
  description: "Search mail, files, chats, calendar, notes and the rest of the suite at once, and ask questions about your own content.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const who = await currentUser();
  return (
    <html lang="en">
      <body className="suite-body">
        <SuiteBar app="search" user={who?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
        <div className="suite-main">{children}</div>
      </body>
    </html>
  );
}
