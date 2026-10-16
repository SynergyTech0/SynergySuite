import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Synergy Stream",
  description: "Your organization's videos: upload, record, edit, share and watch.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
