import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Synergy Hire",
  description: "Job openings, the careers page, applications and the hiring pipeline.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
