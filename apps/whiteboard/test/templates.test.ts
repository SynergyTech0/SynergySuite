import { describe, expect, it } from "vitest";
import { STICKY_COLORS, TEMPLATES, sticky, stickyGrid } from "../lib/templates";

describe("templates", () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))("%s has unique ids and arrows that join real shapes", (_id, t) => {
    const items = t.build();
    expect(items.length).toBeGreaterThan(1);
    const ids = items.map((i) => i.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of items.filter((i) => i.type === "arrow")) {
      expect(ids).toContain((a.start as { id: string }).id);
      expect(ids).toContain((a.end as { id: string }).id);
    }
    // The same ids every time, so two people laying out a template at once can't double it.
    expect(t.build().map((i) => i.id)).toEqual(ids);
  });

  it("makes sticky notes in rows, in the colours asked for", () => {
    const grid = stickyGrid(["a", "b", "c"], 0, 0, { perRow: 2, color: ["pink", "green"] });
    expect(grid.map((g) => [g.x, g.y])).toEqual([[0, 0], [224, 0], [0, 224]]);
    expect(grid.map((g) => g.backgroundColor)).toEqual(["#ffc9c9", "#b2f2bb", "#ffc9c9"]);
    expect(grid[0].label).toMatchObject({ text: "a" });
    expect(sticky(0, 0, "nope").backgroundColor).toBe(STICKY_COLORS[0].fill);
    expect(sticky(0, 0).label).toBeUndefined();
  });
});
