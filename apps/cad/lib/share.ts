import { editorFor } from "./model";
import type { Comment, Drawing, Share } from "./store";

// Plain values only: the share page's client code imports this module, so it must not pull in lib/store.ts.
export const MAX_COMMENT = 2000;
export const MAX_AUTHOR = 80;
export const MAX_COMMENTS = 500;

/** What a share link shows: never the owner, the file's id or the token's other files. */
export type SharedView = {
  name: string;
  size: number;
  modified: string;
  /** Which viewer opens it; null for exports (PDF, images), which are offered as a download. */
  editor: "edit" | "model" | null;
  comments: Comment[];
  /** True when the person looking is the file's owner, who can remove comments. */
  owner: boolean;
};

export function sharedView(file: Drawing, share: Share, owner: boolean): SharedView {
  return { name: file.name, size: file.size, modified: file.modified, editor: editorFor(file.name), comments: share.comments, owner };
}

/** Where a share link opens. */
export function sharePath(token: string): string {
  return `/s/${token}`;
}

/** Checks a posted comment. `signedInAs` is the commenter's name when they're signed in, which wins over any name sent. */
export function commentInput(body: unknown, signedInAs: string | null): { author: string; text: string } | { error: string } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const text = typeof b.text === "string" ? b.text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim() : "";
  if (!text) return { error: "Write a comment first" };
  if (text.length > MAX_COMMENT) return { error: `Comments can be up to ${MAX_COMMENT} characters` };
  const given = typeof b.name === "string" ? b.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_AUTHOR) : "";
  return { author: signedInAs || given || "Guest", text };
}
