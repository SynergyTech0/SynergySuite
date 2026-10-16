import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'SynergyAuth',
  description: 'Single sign-on for the Synergy platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
