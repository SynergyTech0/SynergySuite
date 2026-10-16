import { describe, expect, it } from "vitest";
import { asEngineMessage, saveTarget } from "@/lib/bridge";

describe("engine bridge", () => {
  it("saving under a known name replaces that file", () => {
    expect(saveTarget([{ id: "f1", name: "cat.psd" }], "cat.psd")).toEqual({ replace: "f1" });
    expect(saveTarget([{ id: "f1", name: "cat.png" }, { id: "f2", name: "cat.psd" }], "cat.psd")).toEqual({ replace: "f2" });
  });

  it("any other name adds a new file", () => {
    expect(saveTarget([{ id: "f1", name: "cat.png" }], "cat.psd")).toEqual({ create: "cat.psd" });
    expect(saveTarget([], "Untitled.pcraft")).toEqual({ create: "Untitled.pcraft" });
  });

  it("accepts only well-formed engine messages", () => {
    expect(asEngineMessage({ type: "photocraft:ready" })).toEqual({ type: "photocraft:ready" });
    expect(asEngineMessage({ type: "photocraft:save", name: "a.png", bytes: new ArrayBuffer(1) })?.type).toBe("photocraft:save");
    expect(asEngineMessage({ type: "photocraft:save", name: "a.png", bytes: "nope" })).toBeNull();
    expect(asEngineMessage("photocraft:ready")).toBeNull();
  });
});
