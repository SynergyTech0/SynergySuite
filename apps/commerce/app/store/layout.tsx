import { Suspense, type CSSProperties, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Store } from "lucide-react";
import { getSettings } from "@/lib/settings";
import CartLink from "@/components/store/CartLink";
import SearchBox from "@/components/store/SearchBox";
import "./store.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return {
    title: { default: s.storeName, template: `%s | ${s.storeName}` },
    description: s.store.tagline || undefined,
  };
}

/** Only a plain hex color reaches the page's style; anything else falls back to the default blue. */
function accentOf(v: string): { accent: string; ink: string } {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : "#0f6cbd";
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  // Dark text on light accents, white on dark ones.
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
  return { accent: full, ink: light ? "#111827" : "#ffffff" };
}

export default async function StoreLayout({ children }: { children: ReactNode }) {
  const s = await getSettings();
  const { accent, ink } = accentOf(s.store.accent);
  const style = { "--shop-accent": accent, "--shop-accent-ink": ink } as CSSProperties;
  const open = s.store.enabled;

  return (
    <div className="shop" style={style}>
      <header className="shop-header">
        <div className="shop-wrap shop-header-row">
          <Link href="/store" className="shop-brand">
            <span className="shop-brand-mark" aria-hidden>
              <Store size={20} />
            </span>
            <span className="shop-brand-text">
              <span className="shop-brand-name">{s.storeName}</span>
              {s.store.tagline && <span className="shop-brand-tagline">{s.store.tagline}</span>}
            </span>
          </Link>
          {open && (
            <>
              <Suspense fallback={<div className="shop-search" />}>
                <SearchBox />
              </Suspense>
              <CartLink />
            </>
          )}
        </div>
      </header>

      <main className="shop-main">
        <div className="shop-wrap">
          {open ? (
            children
          ) : (
            <div className="shop-empty">
              <Store size={40} aria-hidden />
              <h1>The store is closed right now</h1>
              <p className="shop-muted">We aren&apos;t taking online orders at the moment. Please check back soon.</p>
            </div>
          )}
        </div>
      </main>

      <footer className="shop-footer">
        <div className="shop-wrap">Powered by Synergy Commerce</div>
      </footer>
    </div>
  );
}
