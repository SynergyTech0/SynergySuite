import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { q } from "@/lib/db";
import { identity } from "@/lib/identity";

export const dynamic = "force-dynamic";

// Bare /slides creates a fresh presentation and opens it, so "New presentation"
// links from the Hub / Drive land on a real, persisted deck.
export default async function NewSlides() {
  const me = await identity();
  const id = randomBytes(9).toString("base64url");
  await q(
    `INSERT INTO documents (id, org, owner_email, kind, title) VALUES ($1, $2, $3, 'slide', 'Untitled presentation')`,
    [id, me.org, me.email || "guest"],
  );
  redirect(`/slides/${id}`);
}
