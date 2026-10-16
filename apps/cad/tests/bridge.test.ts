import { describe, expect, it } from "vitest";
import { asEngineMessage, engineName, saveTarget, saveVersion } from "@/lib/bridge";

describe("engine bridge", () => {
  it("accepts only well-formed engine messages", () => {
    expect(asEngineMessage({ type: "cadcraft:ready", version: "0.7.0" })).toEqual({ type: "cadcraft:ready", version: "0.7.0" });
    expect(asEngineMessage({ type: "cadcraft:save", name: "a.dxf", bytes: new ArrayBuffer(1) })?.type).toBe("cadcraft:save");
    expect(asEngineMessage({ type: "cadcraft:save", name: "a.dxf", bytes: "nope" })).toBeNull();
    expect(asEngineMessage({ type: "cadcraft:dirty", dirty: true })).toEqual({ type: "cadcraft:dirty", dirty: true });
    expect(asEngineMessage({ type: "cadcraft:dirty" })).toBeNull();
    expect(asEngineMessage({ type: "cadcraft:failed", error: "no WebGL" })).toEqual({ type: "cadcraft:failed", error: "no WebGL" });
    expect(asEngineMessage({ type: "photocraft:ready" })).toBeNull();
    expect(asEngineMessage("cadcraft:ready")).toBeNull();
  });

  it("opens DWG files in the engine under a .dxf name", () => {
    expect(engineName("Plan.DWG")).toBe("Plan.dxf");
    expect(engineName("plan.dxf")).toBe("plan.dxf");
  });

  it("saving under a known name replaces that file", () => {
    expect(saveTarget([{ id: "f1", name: "plan.dxf" }], "plan.dxf")).toEqual({ replace: "f1" });
  });

  it("a DWG's DXF save goes back to the DWG, in its version", () => {
    expect(saveTarget([{ id: "f1", name: "plan.dwg", dwg: "AC1027" }], "plan.dxf")).toEqual({ replace: "f1", dwg: "AC1027" });
    // A plain DXF of the same name isn't a DWG's stand-in.
    expect(saveTarget([{ id: "f1", name: "plan.dwg" }], "plan.dxf")).toEqual({ create: "plan.dxf" });
  });

  it("any other name adds a new file", () => {
    expect(saveTarget([{ id: "f1", name: "plan.dwg", dwg: "AC1032" }], "plan.pdf")).toEqual({ create: "plan.pdf" });
    expect(saveTarget([], "Drawing1.dxf")).toEqual({ create: "Drawing1.dxf" });
  });

  it("writes DWG in the file's own version when CADCraft can, else 2018", () => {
    expect(saveVersion("AC1018")).toBe("AC1018");
    expect(saveVersion("AC1014")).toBe("AC1032");
    expect(saveVersion("")).toBe("AC1032");
    expect(saveVersion(null)).toBe("AC1032");
  });
});
