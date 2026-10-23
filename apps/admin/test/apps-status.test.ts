import { describe, expect, it } from "vitest";
import { mapLimit, probe } from "../lib/apps";
import { apps } from "@synergy/config";

describe("mapLimit", () => {
  it("keeps the order and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n * 3));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0, 60]);
    expect(peak).toBe(3);
  });
});

describe("probe", () => {
  it("sends an app one request at a time", async () => {
    const app = apps.find((a) => a.id === "drive")!;
    let open = 0;
    let peak = 0;
    const f = (async () => {
      open++;
      peak = Math.max(peak, open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const s = await probe(app, { fetch: f, env: { NODE_ENV: "test" } as NodeJS.ProcessEnv });
    expect(s.up).toBe(true);
    expect(s.compliance).toBe("connected");
    expect(peak).toBe(1);
  });
});
