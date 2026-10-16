import { describe, expect, it } from "vitest";
import { JqlError, jqlDate, parseJql } from "@/lib/jql";

describe("parseJql", () => {
  it("parses a simple condition", () => {
    expect(parseJql("assignee = me")).toEqual({
      where: { type: "condition", field: "assignee", op: "=", values: [{ kind: "me" }] },
      orderBy: null,
    });
  });

  it("accepts Jira's field aliases", () => {
    expect((parseJql("project = ACME").where as { field: string }).field).toBe("board");
    expect((parseJql("summary ~ login").where as { field: string }).field).toBe("summary");
    expect((parseJql("issuetype = bug").where as { field: string }).field).toBe("type");
  });

  it("AND binds tighter than OR", () => {
    const q = parseJql("type = bug AND priority = high OR type = story");
    expect(q.where).toMatchObject({
      type: "or",
      children: [{ type: "and" }, { type: "condition", field: "type" }],
    });
  });

  it("parentheses override precedence", () => {
    const q = parseJql("type = bug AND (priority = high OR priority = highest)");
    expect(q.where).toMatchObject({ type: "and", children: [{ type: "condition" }, { type: "or" }] });
  });

  it("handles NOT, IN, NOT IN and IS EMPTY", () => {
    expect(parseJql("NOT status = Done").where).toMatchObject({ type: "not" });
    expect(parseJql("priority IN (high, highest)").where).toMatchObject({ op: "in", values: [{ value: "high" }, { value: "highest" }] });
    expect(parseJql("label NOT IN ('a b', c)").where).toMatchObject({ op: "not in", values: [{ value: "a b" }, { value: "c" }] });
    expect(parseJql("assignee IS EMPTY").where).toMatchObject({ op: "is empty" });
    expect(parseJql("due IS NOT EMPTY").where).toMatchObject({ op: "is not empty" });
  });

  it("reads ORDER BY with a direction, and allows it alone", () => {
    expect(parseJql("type = bug ORDER BY priority DESC").orderBy).toEqual({ field: "priority", dir: "desc" });
    expect(parseJql("ORDER BY updated")).toEqual({ where: null, orderBy: { field: "updated", dir: "asc" } });
  });

  it("keeps quoted values whole, including spaces and keywords", () => {
    expect(parseJql("status = 'In Progress'").where).toMatchObject({ values: [{ value: "In Progress" }] });
    expect(parseJql('summary ~ "and or not"').where).toMatchObject({ values: [{ value: "and or not" }] });
  });

  it("is case-insensitive about keywords but not about values", () => {
    expect(parseJql("type = Bug and priority = High").where).toMatchObject({ type: "and" });
    expect(parseJql("summary ~ Login").where).toMatchObject({ values: [{ value: "Login" }] });
  });

  it("explains what is wrong instead of guessing", () => {
    for (const bad of ["squid = 3", "type =", "type == bug", "(type = bug", "status = 'unclosed", "type = bug ORDER BY squid", "type = bug extra"]) {
      expect(() => parseJql(bad), bad).toThrow(JqlError);
    }
  });

  it("an empty query is not an error — it means everything", () => {
    expect(parseJql("   ")).toEqual({ where: null, orderBy: null });
  });
});

describe("jqlDate", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  it("reads absolute and relative dates", () => {
    expect(jqlDate({ kind: "string", value: "2026-09-01" }, now)?.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(jqlDate({ kind: "string", value: "-7d" }, now)?.toISOString().slice(0, 10)).toBe("2026-09-10");
    expect(jqlDate({ kind: "number", value: 3 }, now)?.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(jqlDate({ kind: "string", value: "now" }, now)).toEqual(now);
  });

  it("returns null for nonsense", () => {
    expect(jqlDate({ kind: "string", value: "next tuesday" }, now)).toBeNull();
  });
});
