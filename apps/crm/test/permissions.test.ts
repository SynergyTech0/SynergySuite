import { describe, expect, it } from "vitest";
import { assertAdmin, assertCanEdit, canEdit, canEditActivity, canReassign, isAdmin, resolveOwner } from "../lib/permissions";
import type { Ctx } from "../lib/types";

const rep: Ctx = { email: "rep@example.com", name: "Rep", role: "rep" };
const other: Ctx = { email: "other@example.com", name: "Other", role: "rep" };
const manager: Ctx = { email: "mgr@example.com", name: "Mgr", role: "manager" };
const admin: Ctx = { email: "admin@example.com", name: "Admin", role: "admin" };
const repsRecord = { owner: rep.email };

describe("permissions", () => {
  it("lets reps edit only what they own", () => {
    expect(canEdit(rep, repsRecord)).toBe(true);
    expect(canEdit(other, repsRecord)).toBe(false);
    expect(() => assertCanEdit(other, repsRecord)).toThrow(/owner or a manager/);
    expect(() => assertCanEdit(rep, repsRecord)).not.toThrow();
  });

  it("lets managers and admins edit and reassign anything", () => {
    for (const ctx of [manager, admin]) {
      expect(canEdit(ctx, repsRecord)).toBe(true);
      expect(canReassign(ctx)).toBe(true);
    }
    expect(canReassign(rep)).toBe(false);
  });

  it("keeps role management to admins", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(manager)).toBe(false);
    expect(() => assertAdmin(manager)).toThrow(/admin/);
    expect(() => assertAdmin(admin)).not.toThrow();
  });

  it("resolves the owner: blank or yourself is you; anyone else needs reassign rights", () => {
    expect(resolveOwner(rep)).toBe(rep.email);
    expect(resolveOwner(rep, "")).toBe(rep.email);
    expect(resolveOwner(rep, " REP@example.com ")).toBe(rep.email);
    expect(() => resolveOwner(rep, other.email)).toThrow(/Only managers/);
    expect(resolveOwner(manager, other.email)).toBe(other.email);
  });

  it("lets an activity's assignee, its author or a manager change it", () => {
    const a = { assignee: rep.email, createdBy: other.email };
    expect(canEditActivity(rep, a)).toBe(true);
    expect(canEditActivity(other, a)).toBe(true);
    expect(canEditActivity(manager, a)).toBe(true);
    expect(canEditActivity({ ...rep, email: "third@example.com" }, a)).toBe(false);
  });

  it("refuses with a 403", () => {
    try {
      assertCanEdit(other, repsRecord);
    } catch (e) {
      expect((e as { status: number }).status).toBe(403);
    }
  });
});
