/**
 * Who may change what. Pure rules with no database, so they are tested on their own.
 *
 *   rep      reads everything; edits only records they own
 *   manager  reads and edits everything; may give a record to another owner
 *   admin    everything a manager can, plus changing people's roles
 *
 * Reads are open to everyone in the organization; the roles govern writes.
 */
import { ForbiddenError } from "./util";
import type { Ctx, Role } from "./types";

/** Managers and admins may edit and reassign any record. */
export function canEditAll(ctx: Ctx): boolean {
  return ctx.role === "manager" || ctx.role === "admin";
}

export function canReassign(ctx: Ctx): boolean {
  return canEditAll(ctx);
}

export function isAdmin(ctx: Ctx): boolean {
  return ctx.role === "admin";
}

export function canEdit(ctx: Ctx, record: { owner: string }): boolean {
  return canEditAll(ctx) || record.owner === ctx.email;
}

export function assertCanEdit(ctx: Ctx, record: { owner: string }): void {
  if (!canEdit(ctx, record)) throw new ForbiddenError("Only the owner or a manager can change this record");
}

export function assertAdmin(ctx: Ctx): void {
  if (!isAdmin(ctx)) throw new ForbiddenError("Only an admin can do that");
}

export function assertRole(ctx: Ctx, ...roles: Role[]): void {
  if (!roles.includes(ctx.role)) throw new ForbiddenError();
}

/**
 * The owner for a create or update. Blank means yourself; anyone else needs reassign rights.
 * The caller still checks that the owner is a member.
 */
export function resolveOwner(ctx: Ctx, requested?: string | null): string {
  const want = (requested ?? "").trim().toLowerCase();
  if (!want || want === ctx.email) return ctx.email;
  if (!canReassign(ctx)) throw new ForbiddenError("Only managers can assign records to someone else");
  return want;
}

/** An activity may be changed by whoever it is assigned to, whoever logged it, or a manager. */
export function canEditActivity(ctx: Ctx, a: { assignee: string; createdBy: string | null }): boolean {
  return canEditAll(ctx) || a.assignee === ctx.email || a.createdBy === ctx.email;
}
