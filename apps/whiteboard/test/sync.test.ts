import { describe, expect, it } from "vitest";
import { roleFrom } from "../lib/access.mjs";
import { sceneSummary } from "../lib/scene.mjs";
import { centreOn, changedSince, freeSpot, peersFrom, uniquePeople, viewportCenter, type Presence } from "../lib/sync";

describe("live sync helpers", () => {
  it("sends only elements whose version changed", () => {
    const known = new Map([["a", 1], ["b", 3]]);
    const els = [{ id: "a", version: 1 }, { id: "b", version: 4 }, { id: "c", version: 1 }];
    expect(changedSince(els, known).map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("turns other people's presence into cursors, leaving out this tab and anyone unnamed", () => {
    const states = new Map<number, Presence>([
      [1, { user: { name: "Me", email: "me@x.com" }, pointer: { x: 1, y: 2, tool: "pointer" } }],
      [2, { user: { name: "Bob", email: "bob@x.com", color: { background: "#0001", stroke: "#000" } }, pointer: { x: 5, y: 6, tool: "laser" }, selected: { e1: true } }],
      [3, { pointer: { x: 0, y: 0, tool: "pointer" } }],
      [4, { user: { name: "Bob", email: "bob@x.com" }, pointer: { x: NaN, y: 0, tool: "pointer" } }],
    ]);
    const peers = peersFrom(states, 1);
    expect(peers.map((p) => p.id)).toEqual(["2", "4"]);
    expect(peers[0]).toMatchObject({ username: "Bob", pointer: { x: 5, y: 6, tool: "laser" }, selectedElementIds: { e1: true } });
    expect(peers[1].pointer).toBeUndefined();
    expect(uniquePeople(peers)).toEqual([{ email: "bob@x.com", name: "Bob", color: "#000" }]);
  });

  it("finds the middle of the screen in scene coordinates", () => {
    expect(viewportCenter({ scrollX: -100, scrollY: 50, zoom: { value: 2 }, width: 800, height: 600 })).toEqual({ x: 300, y: 100 });
  });

  it("puts a new sticky note beside one already in the same spot", () => {
    expect(freeSpot(100, 100, [])).toEqual({ x: 100, y: 100 });
    expect(freeSpot(100, 100, [{ x: 100, y: 100 }, { x: 130, y: 130 }, { x: 500, y: 0 }])).toEqual({ x: 160, y: 160 });
  });

  it("centres new shapes on a point, leaving bound arrows to follow their shapes", () => {
    const out = centreOn(
      [
        { type: "rectangle", x: 0, y: 0, width: 100, height: 100 },
        { type: "rectangle", x: 200, y: 0, width: 100, height: 100 },
        { type: "arrow", x: 0, y: 0, start: { id: "a" } },
      ],
      1000,
      1000,
    );
    expect(out.map((o) => [o.x, o.y])).toEqual([[850, 950], [1050, 950], [0, 0]]);
  });
});

describe("access and scene rules shared with the collaboration server", () => {
  const row = (member: "viewer" | "editor" | null, link: "none" | "view" | "edit") => ({ owner: "o@x.com", link_access: link, member_role: member });
  it("takes the best of membership and the link", () => {
    expect(roleFrom(row(null, "none"), "o@x.com")).toBe("owner");
    expect(roleFrom(row(null, "none"), "p@x.com")).toBeNull();
    expect(roleFrom(row(null, "view"), "p@x.com")).toBe("viewer");
    expect(roleFrom(row("viewer", "edit"), "p@x.com")).toBe("editor");
    expect(roleFrom(row("editor", "view"), "p@x.com")).toBe("editor");
    expect(roleFrom(undefined, "p@x.com")).toBeNull();
  });

  it("reads a board's words top to bottom and counts a sticky note once", () => {
    const els = [
      { id: "r", type: "rectangle", x: 0, y: 100 },
      { id: "t2", type: "text", x: 10, y: 120, text: "inside  the\nnote", containerId: "r" },
      { id: "t1", type: "text", x: 500, y: 0, text: "Title" },
      { id: "t0", type: "text", x: 0, y: 3, text: "Left" },
      { id: "gone", type: "text", x: 0, y: 0, text: "deleted", isDeleted: true },
    ].map((e) => JSON.stringify(e));
    expect(sceneSummary([...els, "not json"])).toEqual({ text: "Left\nTitle\ninside the note", count: 3 });
  });
});
