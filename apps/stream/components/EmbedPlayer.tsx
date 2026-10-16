"use client";
import { EmbedPlayerInner } from "./SharedWatch";

export function EmbedPlayer({ token }: { token: string }) {
  return (
    <div className="embed">
      <EmbedPlayerInner token={token} />
    </div>
  );
}
