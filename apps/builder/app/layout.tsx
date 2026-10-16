import "./globals.css";
import type { Metadata } from "next";
import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Synergy Builder",
  description: "Low-code apps on Synergy Base data",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  return (
    <html lang="en">
      <body>
        <SuiteBar app="builder" user={me?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
        {children}
      </body>
    </html>
  );
}
