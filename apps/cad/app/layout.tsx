import "./globals.css";
import type { Metadata } from "next";
import { SuiteBar } from "@/components/SuiteBar";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Synergy CAD",
  description: "2D drafting and DWG/DXF drawings in the Synergy suite",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  return (
    <html lang="en">
      <body>
        <SuiteBar app="cad" user={me?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
        {children}
      </body>
    </html>
  );
}
