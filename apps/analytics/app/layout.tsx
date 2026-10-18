import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Synergy Analytics",
  description: "Privacy-friendly website analytics: page views, visitors, referrers and events.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
