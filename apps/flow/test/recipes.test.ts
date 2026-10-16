import { describe, expect, it } from "vitest";
import { RECIPES } from "../lib/recipes";
import { PIECE_NAME } from "../lib/engine";

describe("recipes", () => {
  it("build flows from the Synergy piece, with the person's connection on every step", () => {
    for (const r of RECIPES) {
      const t = r.build({ email: "ada@example.com", pieceVersion: "0.1.0" }) as any;
      expect(t.type).toBe("PIECE_TRIGGER");
      expect(t.settings.pieceName).toBe(PIECE_NAME);
      expect(t.settings.input.auth).toBe("{{connections['synergy']}}");
      let step = t.nextAction;
      expect(step).toBeTruthy();
      while (step) {
        expect(step.settings.pieceName).toBe(PIECE_NAME);
        expect(step.settings.pieceVersion).toBe("0.1.0");
        expect(step.settings.input.auth).toBe("{{connections['synergy']}}");
        expect(step.valid).toBe(!Object.values(step.settings.input).some((v) => v === null));
        step = step.nextAction;
      }
    }
  });

  it("send the email recipe to the person who made it", () => {
    const t = RECIPES.find((r) => r.id === "form-to-email")!.build({ email: "ada@example.com", pieceVersion: "0.1.0" }) as any;
    expect(t.nextAction.settings.input.to).toBe("ada@example.com");
  });
});
