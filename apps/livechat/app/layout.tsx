import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Synergy LiveChat",
  description: "A chat widget for your websites and an inbox for answering visitors.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
