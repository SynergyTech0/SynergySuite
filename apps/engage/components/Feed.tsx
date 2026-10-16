"use client";
import { useCallback, useEffect, useState } from "react";
import type { FeedPage, Post } from "@/lib/types";
import { api } from "./client";
import { PostCard } from "./PostCard";
import { useApp } from "./Shell";

/** A feed of posts with "Show more"; `prepend` puts a just-written post on top. */
export function Feed({ params, prepend, empty }: { params: Record<string, string>; prepend?: Post | null; empty: React.ReactNode }) {
  const { ai, say } = useApp();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = new URLSearchParams(params).toString();

  const load = useCallback(async (cursor?: string | null) => {
    const p = new URLSearchParams(key);
    if (cursor) p.set("cursor", cursor);
    const page = await api<FeedPage>(`/api/feed?${p}`);
    setPosts((old) => (cursor && old ? [...old, ...page.posts] : page.posts));
    setNext(page.next);
  }, [key]);

  useEffect(() => {
    setPosts(null);
    load().catch((e) => { setPosts([]); say(e.message); });
  }, [load, say]);

  useEffect(() => {
    if (prepend) setPosts((old) => [prepend, ...(old ?? []).filter((p) => p.id !== prepend.id)]);
  }, [prepend]);

  if (posts === null) return <p className="muted center pad">Loading…</p>;
  if (!posts.length) return <div className="empty">{empty}</div>;
  return (
    <div className="feed">
      {posts.map((p) => (
        <PostCard key={`${p.id}:${p.activityAt}:${p.commentCount}`} post={p} ctx={{ ai, say }} onRemoved={(id) => setPosts((old) => old?.filter((x) => x.id !== id) ?? null)} />
      ))}
      {next && (
        <button className="btn morebtn" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await load(next); } catch (e) { say((e as Error).message); } finally { setBusy(false); }
        }}>Show more</button>
      )}
    </div>
  );
}
