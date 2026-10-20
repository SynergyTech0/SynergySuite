import { notFound } from 'next/navigation';
import HubClient, { type HubApp } from '../hub/HubClient';
import '../hub.css';   // the real page imports it here too, not in the component

/*
 * Dev-only render of the REAL HubClient against fixture apps.
 *
 * WHY THIS EXISTS: /hub needs a session, so every visual check of the launcher
 * was being done against a hand-written HTML stand-in that shared the CSS but
 * none of the React. That is how the panel-anchoring bug survived — the
 * stand-in had no panel-positioning code to be wrong. This renders the actual
 * component, so what is on screen is what ships.
 *
 * It is unreachable in production twice over: middleware 404s it, and this
 * calls notFound() outright. It holds no real data — the fixtures below are
 * invented, and nothing here touches sa_apps or a session.
 */
export const dynamic = 'force-dynamic';

const FIXTURES: HubApp[] = [
  ['drive', 'SynergyDrive', '#1a73e8', 'Files', 'Core'],
  ['meet', 'SynergyMeet', '#188038', 'Video', 'Core'],
  ['chat', 'SynergyChat', '#9334e6', 'Messaging', 'Core'],
  ['mail', 'SynergyMail', '#d93025', 'Email', 'Core'],
  ['law', 'SynergyLaw', '#5b3fa8', 'Case management', 'Work'],
  ['emr', 'SynergyEMR', '#0b8043', 'Clinical records', 'Work'],
  ['meter', 'SynergyMeter', '#e37400', 'Usage metering', 'Work'],
  ['sms', 'SynergySMS', null, 'Messaging', 'Work'],
  ['phone', 'SynergyPhone', '#1967d2', 'Voice', 'Work'],
  ['transcribe', 'SynergyTranscribe', '#00838f', 'Speech to text', 'Work'],
  ['erp', 'SynergyERP', '#7cb342', 'Inventory', 'Ops'],
  ['wire', 'SynergyWire', '#c5221f', 'Newswire', 'Ops'],
  ['invest', 'SynergyInvest', '#0f9d58', 'Portfolio', 'Finance'],
  ['flight', 'SynergyFlight', '#3f51b5', 'Drone ops', 'Ops'],
  ['shield', 'SynergyShield', null, 'Device security', 'Ops'],
  ['vault', 'SynergyVault', '#33691e', 'Shared credentials', 'Admin'],
  ['crm', 'SynergyCRM', '#00897b', 'Customers', 'Sales'],
  ['linkcheck', 'synergy-linkcheck', null, 'Link checking', 'Ops'],
  ['auth', 'SynergyAuth', '#0b57d0', 'Identity', 'Admin'],
  ['terminal', 'SynergyTerminal', '#455a64', 'Point of sale', 'Finance'],
  ['sdr', 'SynergySDR', null, 'Outreach', 'Sales'],
  ['db', 'SynergyDB', '#795548', 'Database', 'Ops'],
  ['hub', 'Synergy Hub', '#0b57d0', 'Launcher', 'Admin'],
  ['os', 'SynergyOS', '#607d8b', 'Workstation', 'Ops'],
  ['leadscout', 'LeadScout', null, 'Prospecting', 'Sales'],
  ['site', 'Platform site', '#00696e', 'Public site', 'Admin'],
  ['alias', 'synergy-alias', null, 'Email aliases', 'Ops'],
  ['removals', 'synergy-removals', null, 'Data removal', 'Ops'],
  ['mask', 'synergy-mask', null, 'Number masking', 'Ops'],
  ['verify', 'synergy-verify', null, 'Fleet checks', 'Ops'],
  ['act', 'synergy-act', null, 'Automation', 'Ops'],
  ['aba', 'synergy-aba', '#00838f', 'Parent portal', 'Work'],
  ['syntelligence', 'Syntelligence', '#6a1b9a', 'Shopify AI', 'Sales'],
  ['credit', 'Credit-AI', '#00695c', 'Underwriting', 'Finance'],
  ['weather', 'SynergyWeather', '#0277bd', 'Forecasting', 'Ops'],
  ['backups', 'Backups', null, 'Restore points', 'Ops'],
  ['status', 'Fleet status', null, 'Uptime', 'Ops'],
  ['gitea', 'Gitea', '#4caf50', 'Source control', 'Ops'],
].map(([slug, name, color, description, category]) => ({
  slug, name, color, description, category, url: '#',
}));

export default function DevPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <>
      <link rel="preload" as="font" type="font/woff2" href="/fonts/roboto-var.woff2" crossOrigin="anonymous" />
      <HubClient
        apps={FIXTURES}
        name="Shane Sipe"
        email="admin@example.com"
        isAdmin
        feed={{ events: null, mail: null, docs: null }}
      />
    </>
  );
}
