import { createElement, useEffect } from 'react';
import { useAuth } from '../stores/authStore';

// The suite header with the app launcher, shared by every Synergy app (see @synergy/shell).
// The element upgrades once the shell bundle loads; until then it holds its height so nothing jumps.
export function SuiteBar() {
  const user = useAuth((s) => s.user);
  const domain = useAuth((s) => s.suiteDomain);
  useEffect(() => {
    void import('@synergy/shell');
  }, []);
  return createElement('synergy-app-bar', {
    app: 'books',
    user: user?.email ?? '',
    domain: domain || undefined,
    style: { display: 'block', minHeight: 48, flex: '0 0 auto', background: '#1f2937' },
  });
}
