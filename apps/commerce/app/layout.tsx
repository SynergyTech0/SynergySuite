import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Synergy Commerce",
  description: "Inventory, purchasing, point of sale and an online store.",
};

// The back office and the register add the suite header in (office)/layout.tsx; the public
// online store under /store has its own.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
