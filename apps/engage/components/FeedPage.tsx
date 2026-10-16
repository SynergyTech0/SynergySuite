"use client";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { Post } from "@/lib/types";
import { Composer } from "./Composer";
import { Feed } from "./Feed";
import { useApp } from "./Shell";
import { CatchUp } from "./CatchUp";

const TITLES: Record<string, { title: string; hint: string; empty: React.ReactNode }> = {
  home: {
    title: "Feed",
    hint: "Your communities, the people you follow and posts that mention you.",
    empty: <><p>Nothing here yet.</p><p><Link href="/communities">Join a few communities</Link> or follow people to fill your feed.</p></>,
  },
  discover: { title: "Discover", hint: "Everything you can see across the company.", empty: <p>No one has posted yet. Be the first.</p> },
  mentions: { title: "Mentions and praise", hint: "Posts and replies that name you, and praise for you.", empty: <p>No mentions yet.</p> },
  questions: { title: "Open questions", hint: "Questions in your communities still waiting for a best answer.", empty: <p>No open questions. Nice.</p> },
  saved: { title: "Saved", hint: "Posts you saved for later.", empty: <p>Save a post from its menu to find it here.</p> },
};

export function FeedScreen() {
  const { me, communities, say, ai } = useApp();
  const view = useSearchParams().get("view") ?? "home";
  const t = TITLES[view] ?? TITLES.home;
  const [posted, setPosted] = useState<Post | null>(null);
  return (
    <div className="column">
      <div className="head">
        <div className="titlerow"><h1>{t.title}</h1><span className="grow" />{ai && view === "home" && <CatchUp label={<><Sparkles size={15} /> Catch me up</>} />}</div>
        <p className="muted">{t.hint}</p>
      </div>
      {(view === "home" || view === "discover") && <Composer me={me} communities={communities} onPosted={setPosted} say={say} />}
      <Feed params={{ view }} prepend={posted} empty={t.empty} />
    </div>
  );
}
