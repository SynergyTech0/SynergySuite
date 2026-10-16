import './globals.css';
import type { Metadata } from 'next';
import { Nav } from './nav';

export const metadata: Metadata = {
  title: 'SynergyMail',
  description: 'Marketing email platform on SynergyDB',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app">
          <aside className="side">
            <div className="brand">Synergy<span>Mail</span></div>
            <Nav />
          </aside>
          <div className="main">{children}</div>
        </div>
      </body>
    </html>
  );
}
