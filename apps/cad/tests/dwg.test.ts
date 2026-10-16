import { describe, expect, it } from "vitest";
import { dwgConverter, type WorkerLike } from "@/lib/dwg";

/** A stand-in for the converter worker: `reply` decides each answer. */
function fakeWorkers(reply: (op: string, bytes: Uint8Array) => object) {
  const spawned: { terminated: boolean }[] = [];
  const spawn = (): WorkerLike => {
    const state = { terminated: false };
    spawned.push(state);
    const listeners: Record<string, ((e: never) => void)[]> = { message: [], error: [] };
    return {
      postMessage(msg) {
        const answer = { id: msg.id, ...reply(msg.op, new Uint8Array(msg.bytes)) };
        queueMicrotask(() => listeners.message.forEach((l) => l({ data: answer } as never)));
      },
      addEventListener(type: string, l: (e: never) => void) {
        listeners[type].push(l);
      },
      terminate() {
        state.terminated = true;
      },
    } as WorkerLike;
  };
  return { spawn, spawned };
}

describe("DWG converter", () => {
  it("converts both ways through one worker", async () => {
    const { spawn, spawned } = fakeWorkers((op, b) => ({ ok: true, bytes: new Uint8Array([op === "toDxf" ? 1 : 2, b.length]).buffer, version: op === "toDxf" ? "AC1027" : null }));
    const c = dwgConverter(spawn);
    const r = await c.toDxf(new Uint8Array(3).buffer);
    expect(r.version).toBe("AC1027");
    expect([...new Uint8Array(r.dxf)]).toEqual([1, 3]);
    expect([...new Uint8Array(await c.toDwg(new Uint8Array(5).buffer, "AC1027"))]).toEqual([2, 5]);
    expect(spawned).toHaveLength(1);
  });

  it("reports a failed conversion and keeps the worker", async () => {
    const { spawn, spawned } = fakeWorkers(() => ({ ok: false, error: "DWG: not a DWG file" }));
    const c = dwgConverter(spawn);
    await expect(c.toDxf(new ArrayBuffer(1))).rejects.toThrow("not a DWG file");
    await expect(c.toDxf(new ArrayBuffer(1))).rejects.toThrow();
    expect(spawned).toHaveLength(1);
  });

  it("replaces the worker after a damaged file traps it", async () => {
    let n = 0;
    const { spawn, spawned } = fakeWorkers(() => (++n === 1 ? { ok: false, error: "unreachable", trapped: true } : { ok: true, bytes: new ArrayBuffer(1), version: "AC1032" }));
    const c = dwgConverter(spawn);
    await expect(c.toDxf(new ArrayBuffer(1))).rejects.toThrow("unreachable");
    expect(spawned[0].terminated).toBe(true);
    await expect(c.toDxf(new ArrayBuffer(1))).resolves.toMatchObject({ version: "AC1032" });
    expect(spawned).toHaveLength(2);
  });
});
