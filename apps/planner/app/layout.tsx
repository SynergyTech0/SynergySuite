import "./globals.css";
import type { Metadata } from "next";
import { NotificationBell } from "./NotificationBell";
import { SuiteBar } from "@/components/SuiteBar";
import { getCurrentUserOrNull } from "@/lib/session";

export const metadata: Metadata = {
  title: "SynergyBoards",
  description: "AI-native boards on the Synergy stack",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUserOrNull();
  return (
    <html lang="en">
      <body>
        <SuiteBar app="planner" user={me?.email ?? ""} domain={process.env.SUITE_DOMAIN} />
        <div className="topbar">
          <a href="/" className="brand">Synergy<span>Boards</span></a>
          <a href="/my" className="topnav">My work</a>
          <a href="/search" className="topnav">Search</a>
          <div style={{ flex: 1 }} />
          <NotificationBell />
        </div>
        {children}
      </body>
    </html>
  );
}
