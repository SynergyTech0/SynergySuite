import { describe, expect, it } from "vitest";
import { arrayMove } from "@dnd-kit/sortable";
import { positionAt } from "@/lib/position";

describe("positionAt", () => {
  const cards = [
    { id: "a", position: 1024 },
    { id: "b", position: 2048 },
    { id: "c", position: 3072 },
  ];

  it("moving the first card to the end lands after the last", () => {
    const moved = arrayMove(cards, 0, 2); // b, c, a
    expect(positionAt(moved, 2)).toBeGreaterThan(3072);
  });

  it("moving the last card to the top lands before the first", () => {
    const moved = arrayMove(cards, 2, 0); // c, a, b
    expect(positionAt(moved, 0)).toBeLessThan(1024);
  });

  it("the stale-state mistake: computing from the order BEFORE the move keeps the old position", () => {
    // What Board.onDragEnd used to do — neighbours from the pre-move array at the old index.
    const stale = positionAt(cards, 0);
    expect(stale).toBeLessThan(2048); // still sorts first, so the reorder reverts on refetch
    const correct = positionAt(arrayMove(cards, 0, 2), 2);
    expect(correct).toBeGreaterThan(3072);
  });
});
