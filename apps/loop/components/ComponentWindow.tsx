"use client";
import { Home } from "lucide-react";
import type { Me } from "./client";
import { ComponentCard } from "./ComponentCard";

export function ComponentWindow({ id, me, collabUrl }: { id: string; me: Me; collabUrl: string }) {
  return (
    <div className="window">
      <a className="btn ghost small" href="/">
        <Home size={15} /> Loop home
      </a>
      <ComponentCard id={id} me={me} collabUrl={collabUrl} where="window" />
      <p className="muted small">
        Copy the link and paste it in a chat or onto a Loop page: everyone sees the same component and every change, live.
      </p>
    </div>
  );
}
