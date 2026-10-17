import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Synergy Search",
  description: "Search mail, files, chats, calendar, notes and the rest of the suite at once, and ask questions about your own content.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="suite-body">{children}</body>
    </html>
  );
}
