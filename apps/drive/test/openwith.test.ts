import { describe, expect, it } from "vitest";
import { openWith } from "../components/client";

describe("open with another suite app", () => {
  it("opens .excalidraw boards in Whiteboard on the same domain", () => {
    expect(openWith({ id: "abc", name: "Plan.excalidraw" }, { protocol: "https:", host: "drive.example.com", hostname: "drive.example.com" })).toEqual({
      label: "Open in Whiteboard",
      href: "https://whiteboard.example.com/open?drive=abc",
    });
    expect(openWith({ id: "abc", name: "plan.EXCALIDRAW" }, { protocol: "http:", host: "localhost:3180", hostname: "localhost" })?.href).toBe("http://localhost:3750/open?drive=abc");
    expect(openWith({ id: "abc", name: "plan.png" }, { protocol: "https:", host: "drive.example.com", hostname: "drive.example.com" })).toBeUndefined();
  });
});
