import { describe, expect, it } from "vitest";
import { cents, fromCents, referralStage, referralTotals, rewardCents, rewardOf } from "../lib/rewards";

describe("referral math", () => {
  it("turns money text into cents and back without floats", () => {
    expect(cents("1234.5")).toBe(123450);
    expect(cents("0.07")).toBe(7);
    expect(cents("12")).toBe(1200);
    expect(cents(null)).toBeNull();
    expect(cents("abc")).toBeNull();
    expect(fromCents(123450)).toBe("1234.50");
    expect(fromCents(7)).toBe("0.07");
    expect(fromCents(-250)).toBe("-2.50");
  });

  it("follows the deal once there is one, else the lead", () => {
    const at = (leadStatus: Parameters<typeof referralStage>[0]["leadStatus"], dealStage: Parameters<typeof referralStage>[0]["dealStage"], paid = false) =>
      referralStage({ leadStatus, dealStage, paid });
    expect(at("new", null)).toBe("new");
    expect(at("working", null)).toBe("new");
    expect(at("nurturing", null)).toBe("new");
    expect(at("qualified", null)).toBe("qualified");
    expect(at("unqualified", null)).toBe("lost");
    expect(at("converted", null)).toBe("qualified");
    expect(at("converted", "prospecting")).toBe("qualified");
    expect(at(null, "negotiation")).toBe("qualified");
    expect(at("converted", "closed_won")).toBe("won");
    expect(at(null, "closed_lost")).toBe("lost");
    // A paid one whose deal was deleted was won; one with nothing left is lost.
    expect(at("converted", null, true)).toBe("won");
    expect(at(null, null, true)).toBe("won");
    expect(at(null, null, false)).toBe("lost");
    // A deal still decides, paid or not.
    expect(at("converted", "closed_lost", true)).toBe("lost");
  });

  it("pays a fixed amount or a percentage of the deal, to the cent", () => {
    expect(rewardCents("fixed", "250", "99999")).toBe(25000);
    expect(rewardCents("percent", "10", "48000")).toBe(480000);
    expect(rewardCents("percent", "12.5", "1000.10")).toBe(12501); // 125.0125 rounds to 125.01
    expect(rewardCents("percent", "2.5", "0.30")).toBe(1); // 0.0075 rounds up to a cent
    expect(rewardCents("percent", "10", null)).toBe(0);
  });

  it("owes a reward only once won, and not after it is paid", () => {
    const base = { rewardType: "percent" as const, rewardValue: "10", dealValue: "5000", paidAmount: null };
    expect(rewardOf({ ...base, stage: "qualified" })).toEqual({ reward: null, owed: "0.00" });
    expect(rewardOf({ ...base, stage: "won" })).toEqual({ reward: "500.00", owed: "500.00" });
    expect(rewardOf({ ...base, stage: "won", paidAmount: "450.00" })).toEqual({ reward: "500.00", owed: "0.00" });
  });

  it("adds up a partner's referrals", () => {
    const t = referralTotals([
      { stage: "won", rewardType: "fixed", rewardValue: "100", dealValue: "1000", paidAmount: "100.00" },
      { stage: "won", rewardType: "percent", rewardValue: "5", dealValue: "2000", paidAmount: null },
      { stage: "qualified", rewardType: "fixed", rewardValue: "100", dealValue: null, paidAmount: null },
      { stage: "lost", rewardType: "fixed", rewardValue: "100", dealValue: "900", paidAmount: null },
    ]);
    expect(t).toEqual({ sent: 4, won: 2, earned: "200.00", paid: "100.00", outstanding: "100.00" });
    expect(referralTotals([])).toEqual({ sent: 0, won: 0, earned: "0.00", paid: "0.00", outstanding: "0.00" });
  });
});
