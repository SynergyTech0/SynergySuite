/**
 * DWG support for the browser. CADCraft's web build opens and saves DXF only, so DWG files are
 * converted here with CADCraft's own DWG bridge, compiled to a separate WebAssembly module that
 * runs in a worker (public/dwg-worker.js). wasm32 can't catch panics, so a damaged file can trap
 * that module; when it does, the worker is thrown away and the next conversion starts a new one.
 */
type Request = { id: number; op: "toDxf" | "toDwg"; bytes: ArrayBuffer; version?: string };
type Reply = { id: number; ok: true; bytes: ArrayBuffer; version: string | null } | { id: number; ok: false; error: string; trapped?: boolean };

export interface WorkerLike {
  postMessage(message: Request, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (e: MessageEvent<Reply>) => void): void;
  addEventListener(type: "error", listener: (e: unknown) => void): void;
  terminate(): void;
}

export type Converter = {
  /** DWG bytes to DXF, with the DWG's version code ("AC1032"). */
  toDxf(dwg: ArrayBuffer): Promise<{ dxf: ArrayBuffer; version: string | null }>;
  /** DXF bytes to a DWG of `version`. */
  toDwg(dxf: ArrayBuffer, version: string): Promise<ArrayBuffer>;
};

export function dwgConverter(spawn: () => WorkerLike = () => new Worker("/dwg-worker.js", { type: "module" }) as unknown as WorkerLike): Converter {
  let worker: WorkerLike | null = null;
  let next = 0;
  const pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();

  function discard(why: string) {
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(new Error(why));
    pending.clear();
  }

  function current(): WorkerLike {
    if (worker) return worker;
    const w = spawn();
    w.addEventListener("message", (e) => {
      const reply = e.data;
      const p = pending.get(reply.id);
      if (!p) return;
      pending.delete(reply.id);
      p.resolve(reply);
      if (!reply.ok && reply.trapped && worker === w) discard("the DWG converter stopped");
    });
    w.addEventListener("error", () => {
      if (worker === w) discard("the DWG converter couldn't start");
    });
    worker = w;
    return w;
  }

  async function run(op: Request["op"], bytes: ArrayBuffer, version?: string) {
    const id = ++next;
    const reply = await new Promise<Reply>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      current().postMessage({ id, op, bytes, version }, [bytes]);
    });
    if (!reply.ok) throw new Error(reply.error);
    return reply;
  }

  return {
    async toDxf(dwg) {
      const r = await run("toDxf", dwg);
      return { dxf: r.bytes, version: r.version };
    },
    async toDwg(dxf, version) {
      return (await run("toDwg", dxf, version)).bytes;
    },
  };
}
