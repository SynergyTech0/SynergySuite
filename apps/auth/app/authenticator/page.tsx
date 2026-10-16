import type { Metadata, Viewport } from 'next';
import Authenticator from './authenticator';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Synergy Authenticator',
  description: 'Generate SynergyAuth two-factor codes on your device',
  manifest: '/authenticator.webmanifest',
  appleWebApp: { capable: true, title: 'Synergy Authenticator', statusBarStyle: 'black-translucent' },
  icons: { apple: '/authenticator-icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0b1020',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function AuthenticatorPage() {
  return <Authenticator />;
}
