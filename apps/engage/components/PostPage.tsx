"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Post } from "@/lib/types";
import { api } from "./client";
import { PostCard } from "./PostCard";
import { useApp } from "./Shell";

export function PostPage({ id }: { id: string }) {
  const { ai, say } = useApp();
  const [post, setPost] = useState<Post | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "gone" | "ok">("loading");
  useEffect(() => {
    api<Post>(`/api/posts/${id}`).then((p) => { setPost(p); setState("ok"); }, () => setState("missing"));
  }, [id]);
  if (state === "loading") return <p className="muted center pad">Loading…</p>;
  if (state !== "ok" || !post) {
    return <div className="empty"><p>{state === "gone" ? "The post was deleted." : "This post doesn't exist, or it's in a private community."}</p><Link href="/feed">Back to your feed</Link></div>;
  }
  return (
    <div className="column">
      <PostCard post={post} full ctx={{ ai, say }} onRemoved={() => setState("gone")} />
    </div>
  );
}
