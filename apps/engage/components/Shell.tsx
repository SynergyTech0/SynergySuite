"use client";
import { AtSign, Bookmark, CircleHelp, Compass, House, Lock, Newspaper, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Community } from "@/lib/types";
import { Toast } from "./bits";
import { COLOR_HEX, api, personHref } from "./client";

type Me = { email: string; name: string; admin: boolean };
type Ctx = { me: Me; ai: boolean; say: (t: string) => void; communities: Community[]; reloadCommunities: () => Promise<void> };

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside <Shell>");
  return c;
}

/** The left navigation every Engage page shares, and what the pages need to know about the viewer. */
export function Shell({ me, ai, children }: { me: Me; ai: boolean; children: React.ReactNode }) {
  const [toast, setToast] = useState<string | null>(null);
  const [communities, setCommunities] = useState<Community[]>([]);
  const path = usePathname();
  const view = useSearchParams().get("view") ?? "home";

  const reloadCommunities = useCallback(async () => {
    setCommunities(await api<Community[]>("/api/communities?mine=1"));
  }, []);
  useEffect(() => {
    void reloadCommunities().catch(() => {});
  }, [reloadCommunities]);

  const say = useCallback((t: string) => setToast(t), []);
  const item = (href: string, label: string, icon: React.ReactNode, active: boolean) => (
    <Link href={href} className={`navitem${active ? " active" : ""}`}>{icon}<span className="fname">{label}</span></Link>
  );

  return (
    <AppCtx.Provider value={{ me, ai, say, communities, reloadCommunities }}>
      <div className="engage">
        <nav className="nav" aria-label="Engage">
          {item("/", "Home", <House size={18} />, path === "/")}
          {item("/feed", "Feed", <Newspaper size={18} />, path === "/feed" && view === "home")}
          {item("/feed?view=discover", "Discover", <Compass size={18} />, path === "/feed" && view === "discover")}
          {item("/feed?view=mentions", "Mentions and praise", <AtSign size={18} />, path === "/feed" && view === "mentions")}
          {item("/feed?view=questions", "Open questions", <CircleHelp size={18} />, path === "/feed" && view === "questions")}
          {item("/feed?view=saved", "Saved", <Bookmark size={18} />, path === "/feed" && view === "saved")}
          {item(personHref(me.email), "Your storyline", <UserRound size={18} />, path === personHref(me.email))}
          <div className="navsection">
            <span>Your communities</span>
            <Link className="linkbtn small" href="/communities">All</Link>
          </div>
          {communities.map((c) => (
            <Link key={c.id} href={`/c/${c.slug}`} className={`navitem${path === `/c/${c.slug}` ? " active" : ""}`}>
              <span className="cdot" style={{ background: COLOR_HEX[c.color] }}>{c.name[0]}</span>
              <span className="fname">{c.name}</span>
              {c.privacy === "private" && <Lock size={12} className="muted" />}
            </Link>
          ))}
          {item("/communities", "Browse communities", <Users size={18} />, path === "/communities")}
        </nav>
        <main className="main">{children}</main>
        <Toast text={toast} onClose={() => setToast(null)} />
      </div>
    </AppCtx.Provider>
  );
}
