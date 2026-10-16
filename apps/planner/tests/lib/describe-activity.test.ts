import { describe, expect, it } from "vitest";
import { describeActivity, relativeTime } from "@/lib/describe-activity";

const row = (type: string, data: Record<string, unknown> | null = null, extra = {}) =>
  ({ id: "1", type, data, createdAt: new Date().toISOString(), ...extra });

describe("describeActivity", () => {
  it("reads a move the way a person would say it", () => {
    expect(describeActivity(row("card_moved", { from: "To Do", to: "Done" }))).toBe("moved this card from To Do to Done");
  });

  it("names the card in the board feed, preferring the issue key", () => {
    expect(describeActivity(row("card_created", null, { issueKey: "SYN-7", cardTitle: "x" }), "board")).toBe("created SYN-7");
    expect(describeActivity(row("card_created", null, { cardTitle: "Fix login" }), "board")).toBe("created “Fix login”");
  });

  it("covers the field changes a Jira history shows", () => {
    expect(describeActivity(row("card_updated", { field: "priority", from: "medium", to: "high" })))
      .toBe("changed the priority of this card from medium to high");
    expect(describeActivity(row("card_updated", { field: "points", from: null, to: 5 })))
      .toBe("set the story points of this card to 5");
    expect(describeActivity(row("card_updated", { field: "sprint", from: "Sprint 1", to: null })))
      .toBe("moved this card from sprint “Sprint 1” to the backlog");
    expect(describeActivity(row("card_updated", { field: "isComplete", from: false, to: true })))
      .toBe("marked this card complete");
  });

  it("describes a deleted card from the copy kept in data, since the card is gone", () => {
    expect(describeActivity(row("card_deleted", { title: "Old", issueKey: "SYN-2" }), "board")).toBe("deleted SYN-2 “Old”");
  });

  it("never throws on a type it does not know", () => {
    expect(describeActivity(row("something_new"))).toBe("something new on this card");
  });
  it("names the rule that ran, so nobody has to guess why a card changed on its own", () => {
    expect(describeActivity(row("automation_ran", { rule: "When it ships, say so", did: "commented" }, { issueKey: "SYN-4" }), "board"))
      .toBe("rule “When it ships, say so” commented on SYN-4");
    // a row written before rules carried their name still reads as a sentence
    expect(describeActivity(row("automation_ran", {}, { issueKey: "SYN-4" }), "board")).toBe("ran an automation on SYN-4");
  });

});

describe("relativeTime", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  it("buckets recent times", () => {
    expect(relativeTime("2026-09-17T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-09-17T11:30:00Z", now)).toBe("30m ago");
    expect(relativeTime("2026-09-17T07:00:00Z", now)).toBe("5h ago");
    expect(relativeTime("2026-09-15T12:00:00Z", now)).toBe("2d ago");
  });

});
