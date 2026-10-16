import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Synergy Trust',
  description: 'Compliance readiness for SOC 2, ISO 27001, HIPAA and GDPR.',
};

// The bare document. The signed-in chrome lives in (app)/layout.tsx so that the public
// trust centre never resolves an identity or renders suite navigation.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
