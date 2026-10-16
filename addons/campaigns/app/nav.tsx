'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  ['/', 'Dashboard'],
  ['/audiences', 'Audiences'],
  ['/templates', 'Templates'],
  ['/campaigns', 'Campaigns'],
  ['/automations', 'Automations'],
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {links.map(([href, label]) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link key={href} href={href} className={active ? 'active' : ''}>{label}</Link>
        );
      })}
    </nav>
  );
}
