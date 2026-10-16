import { describe, expect, it } from "vitest";
import { asModelerMessage, documentName, drawingName, editorFor } from "@/lib/model";

describe("3D editor bridge", () => {
  it("accepts only well-formed messages", () => {
    expect(asModelerMessage({ type: "chili3d:ready", version: "0.7.1" })).toEqual({ type: "chili3d:ready", version: "0.7.1" });
    expect(asModelerMessage({ type: "chili3d:save", name: "a.cd", bytes: new ArrayBuffer(1) })?.type).toBe("chili3d:save");
    expect(asModelerMessage({ type: "chili3d:save", name: "a.cd", bytes: "{}" })).toBeNull();
    expect(asModelerMessage({ type: "chili3d:failed" })).toEqual({ type: "chili3d:failed", error: "unknown error" });
    expect(asModelerMessage({ type: "cadcraft:ready" })).toBeNull();
    expect(asModelerMessage(null)).toBeNull();
  });

  it("sends each file to the editor that opens it", () => {
    expect(editorFor("plan.DWG")).toBe("edit");
    expect(editorFor("plan.dxf")).toBe("edit");
    expect(editorFor("bracket.step")).toBe("model");
    expect(editorFor("bracket.STP")).toBe("model");
    expect(editorFor("part.stl")).toBe("model");
    expect(editorFor("bracket.cd")).toBe("model");
    expect(editorFor("plan.pdf")).toBeNull();
  });

  it("names a model after its file", () => {
    expect(documentName("bracket.step")).toBe("bracket");
    expect(documentName("v1.2 bracket.cd")).toBe("v1.2 bracket");
    expect(documentName(".stl")).toBe("Untitled");
  });

  it("takes the model's triangles only when they are consistent", () => {
    const part = { position: new Float32Array(9), index: Uint32Array.of(0, 1, 2), face: Uint32Array.of(0), edges: new Float32Array() };
    expect(asModelerMessage({ type: "chili3d:geometry", id: "a", document: "Bracket", parts: [part] })).toMatchObject({ id: "a", document: "Bracket", parts: [part] });
    expect(asModelerMessage({ type: "chili3d:geometry", id: "a", parts: [{ ...part, index: Uint32Array.of(0, 1, 3) }] })).toBeNull();
    expect(asModelerMessage({ type: "chili3d:geometry", id: "a", parts: [{ ...part, face: new Uint32Array() }] })).toBeNull();
    expect(asModelerMessage({ type: "chili3d:geometry", parts: [] })).toBeNull();
  });

  it("names a drawing after its model", () => {
    expect(drawingName("Bracket")).toBe("Bracket drawing.dxf");
    expect(drawingName(" ")).toBe("Untitled drawing.dxf");
  });
});
