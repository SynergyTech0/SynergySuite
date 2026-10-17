import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { q } from "@/lib/db";
import { identity } from "@/lib/identity";
import { newDocumentLabel } from "@/lib/policy";

export const dynamic = "force-dynamic";

// Bare /sheet creates a fresh spreadsheet and opens it, so "New spreadsheet"
// links from the Hub / Drive land on a real, persisted document.
export default async function NewSheet() {
  const me = await identity();
  const id = randomBytes(9).toString("base64url");
  await q(
    `INSERT INTO documents (id, org, owner_email, kind, title, label_id) VALUES ($1, $2, $3, 'sheet', 'Untitled spreadsheet', $4)`,
    [id, me.org, me.email || "guest", await newDocumentLabel()],
  );
  redirect(`/sheet/${id}`);
}
