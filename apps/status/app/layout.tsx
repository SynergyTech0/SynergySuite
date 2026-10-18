import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Synergy Status",
  description: "Uptime monitors and a public status page.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
