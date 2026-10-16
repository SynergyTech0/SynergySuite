import "./globals.css";
import "@livekit/components-styles";
import type { Metadata } from "next";
import { SuiteBar } from "@/components/SuiteBar";
import { getServerSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "SynergyMeet",
  description: "Video meetings for the Synergy suite — that file their own follow-ups.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  return (
    <html lang="en">
      <body className="suite-body">
        {/* Guests joining from a link see the meeting alone; the suite header is for staff. */}
        {session && <SuiteBar app="meet" user={session.user.email} domain={process.env.SUITE_DOMAIN} />}
        <div className="suite-main">{children}</div>
      </body>
    </html>
  );
}
