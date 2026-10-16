import { describe, expect, it } from "vitest";
import { computePipelineSummary, effectiveProbability, isClosedStage, OPEN_STAGES, STAGE_ORDER, STAGE_PROBABILITY } from "../lib/pipeline";

describe("pipeline math", () => {
  it("orders the stages and gives each a default probability", () => {
    expect(STAGE_ORDER).toEqual(["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"]);
    expect(STAGE_PROBABILITY).toEqual({ prospecting: 10, qualification: 25, proposal: 50, negotiation: 75, closed_won: 100, closed_lost: 0 });
    expect(OPEN_STAGES.every((s) => !isClosedStage(s))).toBe(true);
    expect(isClosedStage("closed_won") && isClosedStage("closed_lost")).toBe(true);
  });

  it("uses a deal's own probability, else its stage's", () => {
    expect(effectiveProbability("proposal", null)).toBe(50);
    expect(effectiveProbability("proposal", undefined)).toBe(50);
    expect(effectiveProbability("proposal", 0)).toBe(0); // zero is a real answer, not "unset"
    expect(effectiveProbability("prospecting", 90)).toBe(90);
  });

  it("rolls deals up by stage, open and won", () => {
    const s = computePipelineSummary([
      { stage: "prospecting", amount: "1000.00", probability: null }, // 10% -> 100
      { stage: "proposal", amount: 2000, probability: 80 }, // 1600
      { stage: "proposal", amount: null, probability: null },
      { stage: "negotiation", amount: "bogus", probability: null }, // unreadable amount counts as 0
      { stage: "closed_won", amount: "5000.50", probability: null },
      { stage: "closed_lost", amount: "700", probability: null },
    ]);
    expect(s.byStage.proposal).toEqual({ stage: "proposal", count: 2, amount: 2000, weightedAmount: 1600 });
    expect(s.byStage.closed_lost).toEqual({ stage: "closed_lost", count: 1, amount: 700, weightedAmount: 0 });
    expect(s.openCount).toBe(4);
    expect(s.openAmount).toBe(3000);
    expect(s.weightedOpenAmount).toBe(1700);
    expect(s.wonCount).toBe(1);
    expect(s.wonAmount).toBe(5000.5);
  });

  it("is all zeros with no deals", () => {
    const s = computePipelineSummary([]);
    expect(s.openCount + s.openAmount + s.weightedOpenAmount + s.wonCount + s.wonAmount).toBe(0);
    expect(Object.keys(s.byStage)).toEqual([...STAGE_ORDER]);
  });
});
