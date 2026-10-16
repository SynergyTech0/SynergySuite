// Small pieces every record module shares: timestamps out of Postgres, owner names, ownership changes.
import { assertMember } from "./members";
import { canEdit, resolveOwner } from "./permissions";
import type { Tq } from "./db";
import type { Ctx } from "./types";

export function iso(v: unknown): string | null {
  return v === null || v === undefined ? null : new Date(v as string).toISOString();
}

/** The owner's display name, falling back to their email. */
export const OWNER_NAME = (alias: string) =>
  `coalesce(nullif((SELECT m.name FROM members m WHERE m.email = ${alias}.owner), ''), ${alias}.owner) AS owner_name`;

export type AuditRow = { owner: string; owner_name: string; created_at: Date; updated_at: Date };

export function audit(ctx: Ctx, r: AuditRow) {
  return {
    owner: r.owner,
    ownerName: r.owner_name,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    editable: canEdit(ctx, r),
  };
}

/**
 * The owner after a create or update: unchanged when the request names none (or the same
 * person), otherwise someone a manager picked who must already be a member.
 */
export async function ownerFor(ctx: Ctx, requested: unknown, current: string | null, tq?: Tq): Promise<string> {
  const want = typeof requested === "string" ? requested.trim().toLowerCase() : "";
  if (!want || want === current) return current ?? ctx.email;
  const owner = resolveOwner(ctx, want);
  if (owner !== ctx.email) await assertMember(owner, tq);
  return owner;
}

/** Copies the keys `b` actually sent over the current values, so a PATCH can send just one field. */
export function merged<T extends Record<string, unknown>>(current: T, b: Record<string, unknown>): T {
  const out = { ...current } as Record<string, unknown>;
  for (const k of Object.keys(current)) if (k in b && b[k] !== undefined) out[k] = b[k];
  return out as T;
}
