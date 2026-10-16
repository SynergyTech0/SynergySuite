import { describe, expect, it } from "vitest";
import { lanesFor } from "@/lib/swimlanes";

const cards = [
  { id: "a", parentId: "E1", assigneeId: "U2", priority: "low", issueType: "task" },
  { id: "b", parentId: null, assigneeId: "U1", priority: "highest", issueType: "bug" },
  { id: "c", parentId: "E1", assigneeId: null, priority: "medium", issueType: "task" },
];
const names = { parents: { E1: "Checkout rework" }, people: { U1: "Ann", U2: "Bo" } };

describe("lanesFor", () => {
  it("with no grouping there is one unlabelled lane holding everything", () => {
    const lanes = lanesFor(cards, "none");
    expect(lanes).toHaveLength(1);
    expect(lanes[0].cards).toHaveLength(3);
  });

  it("groups by epic and puts 'No epic' last", () => {
    const lanes = lanesFor(cards, "epic", names);
    expect(lanes.map((l) => l.label)).toEqual(["Checkout rework", "No epic"]);
    expect(lanes[0].cards.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("groups by assignee with names, unassigned last", () => {
    expect(lanesFor(cards, "assignee", names).map((l) => l.label)).toEqual(["Ann", "Bo", "Unassigned"]);
  });

  it("orders priority lanes by severity, not alphabetically", () => {
    expect(lanesFor(cards, "priority", names).map((l) => l.label)).toEqual(["highest", "low", "medium"].sort((a, b) =>
      ["highest", "high", "medium", "low", "lowest"].indexOf(a) - ["highest", "high", "medium", "low", "lowest"].indexOf(b)));
  });

  it("orders type lanes by hierarchy and shows no empty lanes", () => {
    expect(lanesFor(cards, "type", names).map((l) => l.label)).toEqual(["task", "bug"]);
  });

  it("falls back to sensible defaults for cards missing the field", () => {
    const lanes = lanesFor([{ id: "x" }], "priority");
    expect(lanes.map((l) => l.label)).toEqual(["medium"]);
    expect(lanesFor([{ id: "x" }], "assignee").map((l) => l.label)).toEqual(["Unassigned"]);
  });
});
