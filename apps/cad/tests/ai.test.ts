import { describe, expect, it } from "vitest";
import { assistantSettings, relayProtocol } from "@/lib/ai";
import { assistantMessage } from "@/lib/model";

describe("3D modeling assistant", () => {
  it("is off until the suite has a model, and follows CAD_AI_* over AI_*", async () => {
    expect(await assistantSettings({})).toEqual({ enabled: false });
    expect(await assistantSettings({ AI_MODEL: "llama3.1", AI_PROVIDER: "ollama" })).toEqual({ enabled: true, protocol: "openai", model: "llama3.1" });
    expect(await assistantSettings({ AI_MODEL: "m", AI_API_KEY: "k", CAD_AI_PROVIDER: "anthropic", CAD_AI_MODEL: "big" })).toEqual({ enabled: true, protocol: "anthropic", model: "big" });
    expect(await assistantSettings({ AI_MODEL: "m", AI_API_KEY: "k", AI_PROVIDER: "nonsense" })).toEqual({ enabled: false });
  });

  it("relays only the two chat endpoints", () => {
    expect(relayProtocol("anthropic", ["v1", "messages"])).toBe("anthropic");
    expect(relayProtocol("openai", ["chat", "completions"])).toBe("openai");
    expect(relayProtocol("openai", ["embeddings"])).toBeNull();
    expect(relayProtocol("anthropic", ["v1", "files"])).toBeNull();
    expect(relayProtocol("other", ["v1", "messages"])).toBeNull();
  });

  it("tells the editor where the relay is, and never a key", () => {
    expect(assistantMessage({ enabled: true, protocol: "anthropic", model: "big" })).toEqual({
      type: "chili3d:ai", enabled: true, protocol: "anthropic", model: "big", baseURL: "/api/ai/anthropic",
    });
    expect(assistantMessage({ enabled: false })).toEqual({ type: "chili3d:ai", enabled: false });
  });
});
